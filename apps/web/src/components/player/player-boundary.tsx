import { Component, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

/** A failed lazy chunk must not take the navigation shell down with it. */
export class PlayerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page space-y-4" role="alert">
        <h1 className="font-display text-2xl font-semibold">Couldn't open the player</h1>
        <p className="text-muted-foreground">Check your connection, then reload. An app update may also require a fresh download.</p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload player</Button>
          <Button asChild variant="outline"><Link to="/">Back to your feed</Link></Button>
        </div>
      </div>
    );
  }
}
