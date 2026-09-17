import { useNavigate } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

// Proper 404: unknown routes land here instead of a blank page.
const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div data-testid="not-found-page" className="min-h-screen bg-void gradient-mesh flex flex-col items-center justify-center px-6 text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-zinc-400 font-mono mb-6">
        Error 404
      </p>
      <Compass className="w-16 h-16 text-lime/60 mb-6" aria-hidden="true" />
      <h1 className="font-heading text-4xl md:text-5xl font-bold text-white mb-4">
        This page was never forged.
      </h1>
      {/* §3.14 body adapted: the pack names "your board", which is a wave-4
          route — v1's working view is Saved. Flagged against the pack. */}
      <p className="text-zinc-400 mb-8 max-w-md">
        The link is old or the route is wrong. The radar, the forge, and your saved ideas are one
        click away.
      </p>
      <Button
        onClick={() => navigate("/")}
        data-testid="not-found-home-btn"
        className="bg-lime text-void hover:bg-lime-hover btn-glow"
      >
        Go home
      </Button>
    </div>
  );
};

export default NotFound;
