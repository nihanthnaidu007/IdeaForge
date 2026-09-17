import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

// Proper 404: unknown routes land here instead of a blank page.
const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div data-testid="not-found-page" className="min-h-screen bg-void gradient-mesh flex flex-col items-center justify-center px-6 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-white/40 font-mono mb-6">
        Error 404
      </p>
      <Compass className="w-16 h-16 text-lime/60 mb-6" />
      <h1 className="font-heading text-4xl md:text-5xl font-bold text-white mb-4">
        This idea went off the radar
      </h1>
      <p className="text-white/50 mb-8 max-w-md">
        The page you're looking for doesn't exist — but the trend radar is still running.
      </p>
      <Button
        onClick={() => navigate("/")}
        data-testid="not-found-home-btn"
        className="bg-lime text-void hover:bg-lime-hover btn-glow"
      >
        Back to IdeaForge
      </Button>
    </div>
  );
};

export default NotFound;
