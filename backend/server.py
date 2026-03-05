from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import json
from tavily import TavilyClient
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# API Keys
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')
TAVILY_API_KEY = os.environ.get('TAVILY_API_KEY', '')
JWT_SECRET = os.environ.get('JWT_SECRET', 'ideaforge_default_secret')

# Create the main app
app = FastAPI(title="IdeaForge API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ===== MODELS =====
class UserCreate(BaseModel):
    email: str
    password: str
    name: Optional[str] = None

class UserLogin(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    token: str
    user: dict

class ResearchRequest(BaseModel):
    niche: str = "AI"
    tone: str = "professional"

class GenerateIdeasRequest(BaseModel):
    raw_trends: List[dict]
    niche: str = "AI"
    tone: str = "professional"

class IdeaInsightsRequest(BaseModel):
    idea: dict
    niche: str = "AI"
    tone: str = "professional"

class GeneratePostRequest(BaseModel):
    idea: dict
    format: str
    tone: str = "professional"
    custom_instructions: Optional[str] = ""
    insights: Optional[dict] = None

class TweakPostRequest(BaseModel):
    original_post: str
    tweak_instruction: str
    idea: dict
    format: str

class SaveIdeaRequest(BaseModel):
    topic_title: str
    rating: float
    rating_explanation: str
    targeted_audience: Optional[str] = None
    why_it_matters: Optional[str] = None
    key_aspects: Optional[List[str]] = None
    generated_post: Optional[str] = None
    post_format: Optional[str] = None
    niche: str = "AI"
    tone: str = "professional"
    is_bookmarked: bool = False

class SavedIdea(BaseModel):
    id: str
    user_id: str
    topic_title: str
    rating: float
    rating_explanation: str
    targeted_audience: Optional[str] = None
    why_it_matters: Optional[str] = None
    key_aspects: Optional[List[str]] = None
    generated_post: Optional[str] = None
    post_format: Optional[str] = None
    niche: str
    tone: str
    created_at: str
    is_bookmarked: bool = False

# ===== AUTH HELPERS =====
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=7)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return {"user_id": payload["user_id"], "email": payload["email"]}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ===== AI SYSTEM PROMPTS =====
CLAUDE_IDEA_GENERATION_PROMPT = """You are an expert LinkedIn content strategist specializing in Tech & AI trends. You analyze real-time trend data and generate post ideas that will get high audience attention on LinkedIn.

Given trend research data, generate exactly 5-6 LinkedIn post ideas for the {niche} niche in a {tone} tone.

For each idea, provide:
- title: A specific, compelling post topic (not generic, tied to actual trend)
- rating: Score from 1.0 to 10.0 based on: virality potential, audience relevance, timeliness, uniqueness
- rating_explanation: 2-3 sentences explaining exactly WHY it got this score — what makes it strong or weak

Rules:
- Ideas must be rooted in the actual trends provided, not generic evergreen topics
- Titles should be specific enough to immediately suggest the angle of the post
- Vary the angles: include provocative takes, educational angles, story-based ideas, data-driven angles
- Ratings must be honest — not every idea should be 9+

Respond ONLY with raw JSON array, no markdown, no backticks:
[
  {{"title": "...", "rating": 8.5, "rating_explanation": "..."}}
]"""

CLAUDE_INSIGHTS_PROMPT = """You are an expert LinkedIn content strategist. Given a post idea, provide deep strategic insights to help the creator write a high-performing post.

Analyze the idea and return:
- targeted_audience: Exactly who will engage with this post (be specific — not just "LinkedIn users" but "mid-level engineers considering AI adoption", etc.)
- why_it_matters: Why this topic resonates deeply with that audience right now — emotional and professional triggers
- key_aspects: Array of 4-6 specific points, angles, or elements to include in the post for maximum reach and engagement

Respond ONLY with raw JSON, no markdown, no backticks:
{{"targeted_audience": "...", "why_it_matters": "...", "key_aspects": ["...", "...", "...", "..."]}}"""

GPT_POST_WRITING_PROMPT = """You are a LinkedIn ghostwriter who writes for top tech creators. You write posts that feel 100% human — never like AI wrote them.

STRICT RULES for every post:
1. Simple, conversational English — write like you're talking to a smart friend, not presenting at a conference
2. No AI buzzwords: never use "game-changer", "revolutionary", "cutting-edge", "leverage", "utilize", "delve", "it's worth noting", "in today's fast-paced world"
3. No unnecessary complex vocabulary — if a simple word works, use it
4. Keyword-rich naturally — weave in relevant terms that people actually search for
5. Readable — short sentences, white space, line breaks. LinkedIn posts need breathing room
6. Every post must have a strong opening hook on line 1 that stops the scroll
7. End with a genuine question or clear call to action that invites real conversation
8. No hashtag dumps — maximum 3 highly relevant hashtags at the end
9. Sound like a real person who actually knows this topic deeply

Format the post based on the chosen FORMAT:
- Hot Take: Bold contrarian opinion, challenge a common belief, 150-200 words
- Carousel Idea: Outline 6-8 slides with a hook opening + what each slide covers, 200-250 words  
- Story Post: Personal or observational story structure (setup → tension → insight), 200-280 words
- Listicle: Numbered list with a strong hook, 5-7 punchy items, 180-230 words
- How-To: Step-by-step practical guide, 4-6 clear steps, 200-250 words
- Contrarian Take: Argue against the mainstream narrative with evidence, 150-200 words

Write ONLY the post content. No labels, no meta-commentary, no "Here's your post:"."""

# ===== API ROUTES =====

@api_router.get("/")
async def root():
    return {"message": "IdeaForge API is running"}

# Auth Routes
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(data: UserCreate):
    existing = await db.users.find_one({"email": data.email}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": data.email,
        "password": hash_password(data.password),
        "name": data.name or data.email.split("@")[0],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_id, data.email)
    return {"token": token, "user": {"id": user_id, "email": data.email, "name": user_doc["name"]}}

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email}, {"_id": 0})
    if not user or not verify_password(data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(user["id"], data.email)
    return {"token": token, "user": {"id": user["id"], "email": user["email"], "name": user.get("name", "")}}

@api_router.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["user_id"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

# Research Route (Tavily)
@api_router.post("/research")
async def research_trends(data: ResearchRequest, current_user: dict = Depends(get_current_user)):
    try:
        tavily = TavilyClient(api_key=TAVILY_API_KEY)
        
        queries = [
            f"{data.niche} latest trends site:reddit.com",
            f"{data.niche} viral news today",
            f"trending {data.niche} topics LinkedIn"
        ]
        
        all_results = []
        for query in queries:
            try:
                response = tavily.search(query=query, max_results=3, include_raw_content=False)
                if response and "results" in response:
                    for result in response["results"]:
                        all_results.append({
                            "title": result.get("title", ""),
                            "snippet": result.get("content", "")[:300],
                            "url": result.get("url", ""),
                            "source": query
                        })
            except Exception as e:
                logger.warning(f"Tavily query failed: {e}")
                continue
        
        if not all_results:
            # Fallback to GPT-5.2 if Tavily fails
            all_results = await fallback_trend_research(data.niche, data.tone)
        
        return {"raw_trends": all_results, "niche": data.niche, "tone": data.tone}
    except Exception as e:
        logger.error(f"Research error: {e}")
        all_results = await fallback_trend_research(data.niche, data.tone)
        return {"raw_trends": all_results, "niche": data.niche, "tone": data.tone}

async def fallback_trend_research(niche: str, tone: str) -> List[dict]:
    """Fallback using GPT-5.2 when Tavily fails"""
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"trend-fallback-{uuid.uuid4()}",
            system_message=f"You are a tech trend analyst. Generate 6-8 current trending topics in {niche} that would make great LinkedIn posts. Return JSON array with title and snippet for each."
        ).with_model("openai", "gpt-5.2")
        
        msg = UserMessage(text=f"What are the hottest {niche} trends right now that professionals are discussing? Give me 6-8 specific trends with brief descriptions. Return as JSON array: [{{'title': '...', 'snippet': '...'}}]")
        response = await chat.send_message(msg)
        
        try:
            trends = json.loads(response)
            return [{"title": t.get("title", ""), "snippet": t.get("snippet", ""), "url": "", "source": "AI-generated"} for t in trends]
        except:
            return [{"title": f"Hot trend in {niche}", "snippet": response[:200], "url": "", "source": "AI-generated"}]
    except Exception as e:
        logger.error(f"Fallback research failed: {e}")
        return [{"title": f"Emerging {niche} Trends", "snippet": "Industry-wide adoption and innovations", "url": "", "source": "default"}]

# Generate Ideas Route (Claude Sonnet)
@api_router.post("/generate-ideas")
async def generate_ideas(data: GenerateIdeasRequest, current_user: dict = Depends(get_current_user)):
    try:
        trends_text = "\n".join([f"- {t['title']}: {t['snippet']}" for t in data.raw_trends[:8]])
        
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ideas-{uuid.uuid4()}",
            system_message=CLAUDE_IDEA_GENERATION_PROMPT.format(niche=data.niche, tone=data.tone)
        ).with_model("anthropic", "claude-4-sonnet-20250514")
        
        msg = UserMessage(text=f"Here are the current trends:\n{trends_text}\n\nGenerate 5-6 LinkedIn post ideas based on these trends.")
        response = await chat.send_message(msg)
        
        try:
            # Clean response if it has markdown
            clean_response = response.strip()
            if clean_response.startswith("```"):
                clean_response = clean_response.split("```")[1]
                if clean_response.startswith("json"):
                    clean_response = clean_response[4:]
            ideas = json.loads(clean_response)
            return {"ideas": ideas}
        except json.JSONDecodeError:
            # Fallback to GPT-5.2
            return await fallback_generate_ideas(data)
    except Exception as e:
        logger.error(f"Claude idea generation failed: {e}")
        return await fallback_generate_ideas(data)

async def fallback_generate_ideas(data: GenerateIdeasRequest):
    """Fallback using GPT-5.2 when Claude fails"""
    try:
        trends_text = "\n".join([f"- {t['title']}: {t['snippet']}" for t in data.raw_trends[:8]])
        
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ideas-fallback-{uuid.uuid4()}",
            system_message=CLAUDE_IDEA_GENERATION_PROMPT.format(niche=data.niche, tone=data.tone)
        ).with_model("openai", "gpt-5.2")
        
        msg = UserMessage(text=f"Here are the current trends:\n{trends_text}\n\nGenerate 5-6 LinkedIn post ideas based on these trends.")
        response = await chat.send_message(msg)
        
        clean_response = response.strip()
        if clean_response.startswith("```"):
            clean_response = clean_response.split("```")[1]
            if clean_response.startswith("json"):
                clean_response = clean_response[4:]
        ideas = json.loads(clean_response)
        return {"ideas": ideas}
    except Exception as e:
        logger.error(f"Fallback idea generation failed: {e}")
        return {"ideas": [
            {"title": f"Why {data.niche} is Changing Everything", "rating": 7.5, "rating_explanation": "Broad topic with solid engagement potential"},
            {"title": f"3 Things I Learned About {data.niche} This Week", "rating": 8.0, "rating_explanation": "Personal learning content performs well"},
            {"title": f"The Uncomfortable Truth About {data.niche}", "rating": 8.5, "rating_explanation": "Contrarian takes drive engagement"},
            {"title": f"Stop Doing This in {data.niche}", "rating": 7.8, "rating_explanation": "Negative hooks grab attention"},
            {"title": f"My {data.niche} Prediction for 2025", "rating": 7.2, "rating_explanation": "Future predictions spark discussion"}
        ]}

# Idea Insights Route (Claude Sonnet)
@api_router.post("/idea-insights")
async def get_idea_insights(data: IdeaInsightsRequest, current_user: dict = Depends(get_current_user)):
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"insights-{uuid.uuid4()}",
            system_message=CLAUDE_INSIGHTS_PROMPT
        ).with_model("anthropic", "claude-4-sonnet-20250514")
        
        msg = UserMessage(text=f"Analyze this post idea for {data.niche} content with a {data.tone} tone:\n\nTitle: {data.idea.get('title', '')}\nRating: {data.idea.get('rating', 0)}\nExplanation: {data.idea.get('rating_explanation', '')}")
        response = await chat.send_message(msg)
        
        try:
            clean_response = response.strip()
            if clean_response.startswith("```"):
                clean_response = clean_response.split("```")[1]
                if clean_response.startswith("json"):
                    clean_response = clean_response[4:]
            insights = json.loads(clean_response)
            return insights
        except json.JSONDecodeError:
            return await fallback_idea_insights(data)
    except Exception as e:
        logger.error(f"Claude insights failed: {e}")
        return await fallback_idea_insights(data)

async def fallback_idea_insights(data: IdeaInsightsRequest):
    """Fallback using GPT-5.2 when Claude fails"""
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"insights-fallback-{uuid.uuid4()}",
            system_message=CLAUDE_INSIGHTS_PROMPT
        ).with_model("openai", "gpt-5.2")
        
        msg = UserMessage(text=f"Analyze this post idea for {data.niche} content:\n\nTitle: {data.idea.get('title', '')}")
        response = await chat.send_message(msg)
        
        clean_response = response.strip()
        if clean_response.startswith("```"):
            clean_response = clean_response.split("```")[1]
            if clean_response.startswith("json"):
                clean_response = clean_response[4:]
        return json.loads(clean_response)
    except Exception as e:
        logger.error(f"Fallback insights failed: {e}")
        return {
            "targeted_audience": f"Tech professionals interested in {data.niche}",
            "why_it_matters": "This topic addresses current industry challenges",
            "key_aspects": ["Industry context", "Personal experience", "Actionable advice", "Future outlook"]
        }

# Generate Post Route (GPT-5.2)
@api_router.post("/generate-post")
async def generate_post(data: GeneratePostRequest, current_user: dict = Depends(get_current_user)):
    try:
        format_instruction = f"Format: {data.format}"
        custom = f"\n\nAdditional instructions: {data.custom_instructions}" if data.custom_instructions else ""
        
        insights_context = ""
        if data.insights:
            insights_context = f"""
Target Audience: {data.insights.get('targeted_audience', '')}
Why It Matters: {data.insights.get('why_it_matters', '')}
Key Aspects to Cover: {', '.join(data.insights.get('key_aspects', []))}
"""
        
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"post-{uuid.uuid4()}",
            system_message=GPT_POST_WRITING_PROMPT
        ).with_model("openai", "gpt-5.2")
        
        msg = UserMessage(text=f"""Write a LinkedIn post about: {data.idea.get('title', '')}

Tone: {data.tone}
{format_instruction}
{insights_context}
{custom}

Write the post now.""")
        
        response = await chat.send_message(msg)
        return {"post": response.strip()}
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Post generation failed: {error_msg}")
        
        # Check for budget exceeded error and provide helpful message
        if "budget" in error_msg.lower() or "exceeded" in error_msg.lower():
            raise HTTPException(
                status_code=402, 
                detail="API budget exceeded. Please add more balance to your Universal Key in Profile -> Universal Key -> Add Balance"
            )
        raise HTTPException(status_code=500, detail="Failed to generate post. Please try again.")

# Regenerate Post Route
@api_router.post("/regenerate-post")
async def regenerate_post(data: GeneratePostRequest, current_user: dict = Depends(get_current_user)):
    return await generate_post(data, current_user)

# Tweak Post Route
@api_router.post("/tweak-post")
async def tweak_post(data: TweakPostRequest, current_user: dict = Depends(get_current_user)):
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"tweak-{uuid.uuid4()}",
            system_message=GPT_POST_WRITING_PROMPT
        ).with_model("openai", "gpt-5.2")
        
        msg = UserMessage(text=f"""Here is the original LinkedIn post:

{data.original_post}

Please modify it based on this instruction: {data.tweak_instruction}

Keep the same format ({data.format}) and maintain the core message about "{data.idea.get('title', '')}".

Write the updated post now.""")
        
        response = await chat.send_message(msg)
        return {"post": response.strip()}
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Tweak post failed: {error_msg}")
        
        if "budget" in error_msg.lower() or "exceeded" in error_msg.lower():
            raise HTTPException(
                status_code=402, 
                detail="API budget exceeded. Please add more balance to your Universal Key."
            )
        raise HTTPException(status_code=500, detail="Failed to tweak post. Please try again.")

# Save Idea Routes
@api_router.post("/save-idea", response_model=SavedIdea)
async def save_idea(data: SaveIdeaRequest, current_user: dict = Depends(get_current_user)):
    idea_id = str(uuid.uuid4())
    idea_doc = {
        "id": idea_id,
        "user_id": current_user["user_id"],
        "topic_title": data.topic_title,
        "rating": data.rating,
        "rating_explanation": data.rating_explanation,
        "targeted_audience": data.targeted_audience,
        "why_it_matters": data.why_it_matters,
        "key_aspects": data.key_aspects,
        "generated_post": data.generated_post,
        "post_format": data.post_format,
        "niche": data.niche,
        "tone": data.tone,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "is_bookmarked": data.is_bookmarked
    }
    await db.saved_ideas.insert_one(idea_doc)
    return SavedIdea(**idea_doc)

@api_router.get("/saved", response_model=List[SavedIdea])
async def get_saved_ideas(current_user: dict = Depends(get_current_user)):
    ideas = await db.saved_ideas.find(
        {"user_id": current_user["user_id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return ideas

@api_router.delete("/saved/{idea_id}")
async def delete_saved_idea(idea_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.saved_ideas.delete_one({
        "id": idea_id,
        "user_id": current_user["user_id"]
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Idea not found")
    return {"message": "Idea deleted"}

@api_router.patch("/saved/{idea_id}/bookmark")
async def toggle_bookmark(idea_id: str, current_user: dict = Depends(get_current_user)):
    idea = await db.saved_ideas.find_one(
        {"id": idea_id, "user_id": current_user["user_id"]},
        {"_id": 0}
    )
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")
    
    new_status = not idea.get("is_bookmarked", False)
    await db.saved_ideas.update_one(
        {"id": idea_id},
        {"$set": {"is_bookmarked": new_status}}
    )
    return {"is_bookmarked": new_status}

# User Preferences Routes
@api_router.get("/preferences")
async def get_preferences(current_user: dict = Depends(get_current_user)):
    prefs = await db.user_preferences.find_one(
        {"user_id": current_user["user_id"]},
        {"_id": 0}
    )
    if not prefs:
        return {"default_tone": "professional", "default_niche": "AI"}
    return prefs

@api_router.post("/preferences")
async def save_preferences(data: dict, current_user: dict = Depends(get_current_user)):
    await db.user_preferences.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {
            "user_id": current_user["user_id"],
            "default_tone": data.get("default_tone", "professional"),
            "default_niche": data.get("default_niche", "AI"),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"message": "Preferences saved"}

# Include the router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
