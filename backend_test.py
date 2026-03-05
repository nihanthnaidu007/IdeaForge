import requests
import sys
import json
import time
from datetime import datetime

class IdeaForgeAPITester:
    def __init__(self, base_url="https://trend-vault-7.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.token = None
        self.user_id = None
        self.tests_run = 0
        self.tests_passed = 0
        self.critical_failures = []
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}: PASSED")
        else:
            print(f"❌ {name}: FAILED - {details}")
            self.critical_failures.append({"test": name, "details": details})
        
        self.test_results.append({
            "test": name,
            "passed": success,
            "details": details
        })

    def run_test(self, name, method, endpoint, expected_status=200, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.api_url}/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            test_headers.update(headers)

        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, timeout=30)
            elif method == 'PATCH':
                response = requests.patch(url, json=data, headers=test_headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, timeout=30)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}, Expected: {expected_status}"
            
            if not success:
                try:
                    error_detail = response.json()
                    details += f", Response: {error_detail}"
                except:
                    details += f", Response: {response.text[:200]}"

            self.log_test(name, success, details)
            
            if success:
                try:
                    return response.json()
                except:
                    return {"success": True}
            return None

        except Exception as e:
            self.log_test(name, False, f"Error: {str(e)}")
            return None

    def test_health(self):
        """Test API health"""
        return self.run_test("API Health Check", "GET", "", 200)

    def test_register(self):
        """Test user registration"""
        test_email = f"test_{int(time.time())}@ideaforge.test"
        test_password = "TestPass123!"
        test_name = "Test User"
        
        data = {
            "email": test_email,
            "password": test_password,
            "name": test_name
        }
        
        result = self.run_test("User Registration", "POST", "auth/register", 200, data)
        if result and "token" in result:
            self.token = result["token"]
            self.user_id = result["user"]["id"]
            print(f"   ✅ Registered user: {test_email}")
            return True
        return False

    def test_login(self):
        """Test user login with existing user"""
        test_email = f"test_{int(time.time())}@ideaforge.test"
        test_password = "TestPass123!"
        
        # First register
        register_data = {
            "email": test_email,
            "password": test_password,
            "name": "Test User Login"
        }
        
        register_result = self.run_test("Register for Login Test", "POST", "auth/register", 200, register_data)
        if not register_result:
            return False
        
        # Now test login
        login_data = {
            "email": test_email,
            "password": test_password
        }
        
        result = self.run_test("User Login", "POST", "auth/login", 200, login_data)
        if result and "token" in result:
            print(f"   ✅ Logged in user: {test_email}")
            return True
        return False

    def test_get_me(self):
        """Test get current user"""
        return self.run_test("Get Current User", "GET", "auth/me", 200) is not None

    def test_research_trends(self):
        """Test trend research with Tavily"""
        data = {
            "niche": "AI",
            "tone": "professional"
        }
        
        print(f"   ⏳ This may take 10-15 seconds for Tavily API call...")
        result = self.run_test("Research Trends", "POST", "research", 200, data)
        
        if result and "raw_trends" in result:
            trends_count = len(result["raw_trends"])
            print(f"   ✅ Found {trends_count} trends")
            return result["raw_trends"]
        return None

    def test_generate_ideas(self, raw_trends):
        """Test idea generation with Claude"""
        if not raw_trends:
            print("   ⚠️ Skipping - no trends available")
            return None
            
        data = {
            "raw_trends": raw_trends[:5],  # Limit to 5 trends
            "niche": "AI",
            "tone": "professional"
        }
        
        print(f"   ⏳ This may take 10-15 seconds for Claude API call...")
        result = self.run_test("Generate Ideas", "POST", "generate-ideas", 200, data)
        
        if result and "ideas" in result:
            ideas_count = len(result["ideas"])
            print(f"   ✅ Generated {ideas_count} ideas")
            return result["ideas"]
        return None

    def test_idea_insights(self, ideas):
        """Test idea insights with Claude"""
        if not ideas:
            print("   ⚠️ Skipping - no ideas available")
            return None
            
        test_idea = ideas[0]  # Use first idea
        data = {
            "idea": test_idea,
            "niche": "AI",
            "tone": "professional"
        }
        
        print(f"   ⏳ This may take 10-15 seconds for Claude API call...")
        result = self.run_test("Get Idea Insights", "POST", "idea-insights", 200, data)
        
        if result and "targeted_audience" in result:
            print(f"   ✅ Got insights for idea: {test_idea.get('title', 'Unknown')[:50]}")
            return result
        return None

    def test_generate_post(self, ideas, insights):
        """Test post generation with GPT-5.2"""
        if not ideas:
            print("   ⚠️ Skipping - no ideas available")
            return None
            
        test_idea = ideas[0]
        data = {
            "idea": test_idea,
            "format": "hot-take",
            "tone": "professional",
            "custom_instructions": "Keep it engaging and professional",
            "insights": insights
        }
        
        print(f"   ⏳ This may take 10-20 seconds for GPT-5.2 API call...")
        result = self.run_test("Generate Post", "POST", "generate-post", 200, data)
        
        if result and "post" in result:
            post_length = len(result["post"])
            print(f"   ✅ Generated post ({post_length} chars)")
            return result["post"]
        return None

    def test_tweak_post(self, post, ideas):
        """Test post tweaking"""
        if not post or not ideas:
            print("   ⚠️ Skipping - no post or ideas available")
            return None
            
        data = {
            "original_post": post,
            "tweak_instruction": "Make it more engaging and add an emoji",
            "idea": ideas[0],
            "format": "hot-take"
        }
        
        result = self.run_test("Tweak Post", "POST", "tweak-post", 200, data)
        return result.get("post") if result else None

    def test_save_idea(self, ideas, post=None):
        """Test saving an idea"""
        if not ideas:
            print("   ⚠️ Skipping - no ideas available")
            return None
            
        test_idea = ideas[0]
        data = {
            "topic_title": test_idea.get("title", "Test Idea"),
            "rating": test_idea.get("rating", 7.5),
            "rating_explanation": test_idea.get("rating_explanation", "Test explanation"),
            "targeted_audience": "Tech professionals",
            "why_it_matters": "Important for industry",
            "key_aspects": ["Innovation", "Implementation", "Impact"],
            "generated_post": post,
            "post_format": "hot-take" if post else None,
            "niche": "AI",
            "tone": "professional",
            "is_bookmarked": False
        }
        
        result = self.run_test("Save Idea", "POST", "save-idea", 200, data)
        if result and "id" in result:
            print(f"   ✅ Saved idea with ID: {result['id']}")
            return result["id"]
        return None

    def test_get_saved_ideas(self):
        """Test retrieving saved ideas"""
        result = self.run_test("Get Saved Ideas", "GET", "saved", 200)
        if result is not None:
            ideas_count = len(result)
            print(f"   ✅ Retrieved {ideas_count} saved ideas")
            return result
        return None

    def test_preferences(self):
        """Test user preferences"""
        # Get preferences
        prefs = self.run_test("Get Preferences", "GET", "preferences", 200)
        
        # Save preferences
        save_data = {
            "default_tone": "casual",
            "default_niche": "Web Dev"
        }
        
        save_result = self.run_test("Save Preferences", "POST", "preferences", 200, save_data)
        return prefs is not None and save_result is not None

    def run_full_test_suite(self):
        """Run complete test suite"""
        print("🚀 Starting IdeaForge API Test Suite")
        print(f"📡 Testing API at: {self.api_url}")
        print("=" * 50)
        
        # Basic tests
        if not self.test_health():
            print("❌ API Health check failed - stopping tests")
            return self.generate_report()
        
        if not self.test_register():
            print("❌ Registration failed - stopping tests")
            return self.generate_report()
            
        # Auth tests
        self.test_login()
        self.test_get_me()
        
        # Core workflow tests
        raw_trends = self.test_research_trends()
        ideas = self.test_generate_ideas(raw_trends)
        insights = self.test_idea_insights(ideas)
        post = self.test_generate_post(ideas, insights)
        
        # Post manipulation tests
        self.test_tweak_post(post, ideas)
        
        # Data persistence tests
        saved_idea_id = self.test_save_idea(ideas, post)
        self.test_get_saved_ideas()
        
        # Settings tests
        self.test_preferences()
        
        return self.generate_report()

    def generate_report(self):
        """Generate final test report"""
        print("\n" + "=" * 50)
        print("📊 TEST SUMMARY")
        print("=" * 50)
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {len(self.critical_failures)}")
        print(f"Success Rate: {success_rate:.1f}%")
        
        if self.critical_failures:
            print("\n❌ CRITICAL FAILURES:")
            for failure in self.critical_failures:
                print(f"   • {failure['test']}: {failure['details']}")
        
        # Determine if backend is mostly functional
        critical_apis = ["API Health Check", "User Registration", "User Login", "Research Trends"]
        critical_passed = sum(1 for result in self.test_results 
                            if result["test"] in critical_apis and result["passed"])
        
        backend_functional = critical_passed >= 3  # At least 3 critical APIs working
        
        return {
            "success_rate": success_rate,
            "backend_functional": backend_functional,
            "critical_failures": self.critical_failures,
            "test_results": self.test_results
        }

if __name__ == "__main__":
    tester = IdeaForgeAPITester()
    report = tester.run_full_test_suite()
    
    # Exit with appropriate code
    exit_code = 0 if report["success_rate"] > 70 else 1
    sys.exit(exit_code)