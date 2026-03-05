# IdeaForge - LinkedIn Idea Generator PRD

## Project Overview
**Name:** IdeaForge  
**Tagline:** Trend-Powered LinkedIn Intelligence  
**Date:** January 2026  
**Status:** MVP Complete

## Original Problem Statement
Build a production-grade LinkedIn Idea Generator that scans live internet trends in Tech & AI, generates scored post ideas, and crafts human-sounding LinkedIn posts in multiple formats. Multi-API pipeline: Tavily for live trend research → Claude Sonnet for idea generation & analysis → GPT-5.2 for post writing.

## Tech Stack
- **Frontend:** React 19 + Tailwind CSS + Framer Motion
- **Backend:** FastAPI (Python)
- **Database:** MongoDB
- **AI Pipeline:**
  - Tavily API (live web trend research)
  - Claude Sonnet (idea generation via Emergent LLM Key)
  - GPT-5.2 (post writing via Emergent LLM Key)
- **Auth:** JWT-based custom authentication

## User Personas
1. **Content Creators** - Professionals looking to grow LinkedIn presence
2. **Tech Influencers** - Thought leaders wanting to stay on top of trends
3. **Marketing Teams** - B2B marketers needing consistent content
4. **Career Professionals** - Job seekers wanting to build personal brand

## Core Requirements (Static)
- [x] Landing page with hero, features, how-it-works sections
- [x] JWT authentication (register/login)
- [x] Trend research via Tavily API
- [x] AI-scored idea generation via Claude
- [x] Expandable idea cards with ratings
- [x] Audience insights for selected ideas
- [x] 6 post format options (Hot Take, Carousel, Story, Listicle, How-To, Contrarian)
- [x] Post generation via GPT-5.2
- [x] Post regeneration and tweaking
- [x] Save/bookmark ideas to database
- [x] Settings page with preferences

## What's Been Implemented (Jan 2026)

### Backend API Routes
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `POST /api/research` - Tavily trend research
- `POST /api/generate-ideas` - Claude idea generation
- `POST /api/idea-insights` - Claude audience insights
- `POST /api/generate-post` - GPT-5.2 post writing
- `POST /api/regenerate-post` - Re-generate post
- `POST /api/tweak-post` - Modify existing post
- `POST /api/save-idea` - Save idea to database
- `GET /api/saved` - Get saved ideas
- `DELETE /api/saved/:id` - Delete saved idea
- `PATCH /api/saved/:id/bookmark` - Toggle bookmark
- `GET /api/preferences` - Get user preferences
- `POST /api/preferences` - Save user preferences

### Frontend Pages
- `/` - Landing page with dark premium design
- `/dashboard` - Main generator interface
- `/saved` - Saved ideas gallery
- `/settings` - API keys & preferences

### Design System
- Dark premium theme (#050508 background)
- Electric Lime (#D4F844) accent
- Syne + DM Mono typography
- Staggered card animations
- Color-coded ratings (green 8+, amber 6-7.9, muted <6)

## Known Limitations
- Post generation requires Universal Key balance (402 error handling implemented)
- Supabase integration deferred (using MongoDB instead)

## Prioritized Backlog

### P0 (Critical) - DONE
- [x] Core idea generation pipeline
- [x] Authentication flow
- [x] Post generation with formats

### P1 (High Priority) - Future
- [ ] Supabase migration for production
- [ ] Social auth (Google OAuth)
- [ ] Post scheduling integration
- [ ] Export to LinkedIn API

### P2 (Nice to Have)
- [ ] Team workspaces
- [ ] Analytics dashboard
- [ ] A/B testing for post variants
- [ ] Chrome extension for quick generation

## Next Tasks
1. Add more balance to Universal Key for full post generation testing
2. Implement Supabase for production database
3. Add social login options
4. Build analytics for saved ideas performance
