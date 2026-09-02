import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthForm } from "@/components/AuthForm";

/**
 * Non-blocking sign-in prompt. Opened via `useAuth().askSignIn(...)` when a
 * guest hits an action that needs an account — no navigation, so the page
 * (an open book, a selected word) stays exactly where it was.
 */
export function SignInDialog({
  open,
  purpose,
  onClose,
}: {
  open: boolean;
  purpose?: string | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Sign in to Annangsue</DialogTitle>
          {purpose && <DialogDescription className="text-mute">{purpose}</DialogDescription>}
        </DialogHeader>
        <div className="rounded-2xl border border-border bg-card p-6">
          <AuthForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
