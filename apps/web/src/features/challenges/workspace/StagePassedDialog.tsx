import type { Challenge } from "@sdl/challenges";
import { Bookmark, PartyPopper, Trophy } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Celebration } from "@/features/playground/simulation/Celebration";

/** The stage-pass moment: what was achieved, the checkpoint, and what's next. */
export function StagePassedDialog({
  open,
  challenge,
  stageIndex,
  checkpoint,
  onContinue,
  onClose,
}: {
  open: boolean;
  challenge: Challenge;
  stageIndex: number;
  /** Whether a checkpoint of the design was saved (signed-in users). */
  checkpoint: boolean;
  onContinue(): void;
  onClose(): void;
}) {
  const stage = challenge.stages[stageIndex]!;
  const next = challenge.stages[stageIndex + 1];
  const Icon = next ? PartyPopper : Trophy;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="sdl-badge-pop mx-auto mb-1 flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
            <Icon className="size-6" aria-hidden />
          </div>
          <DialogTitle className="text-center">
            {next ? `Stage ${stageIndex + 1} passed` : `${challenge.title} complete`}
          </DialogTitle>
          <DialogDescription className="text-center">
            {next
              ? `"${stage.title}" is done. Next up: ${next.title}.`
              : "Every stage passed. You estimated, built, scaled and stress-tested a real system."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center">
          <Celebration />
        </div>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Bookmark className="size-3.5" aria-hidden />
          {checkpoint
            ? "A checkpoint of this design was saved."
            : "Sign in to keep a checkpoint of your design at each stage."}
        </p>
        <DialogFooter className="sm:justify-center">
          {next ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Keep exploring
              </Button>
              <Button onClick={onContinue}>Continue to stage {stageIndex + 2}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Keep exploring
              </Button>
              <Button asChild>
                <Link to="/">Go to the dashboard</Link>
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
