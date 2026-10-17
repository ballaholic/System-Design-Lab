import { CircleAlert, Copy, LayoutTemplate, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/authContext";
import {
  useArchitectureList,
  useDeleteArchitecture,
  useDuplicateArchitecture,
  useRenameArchitecture,
} from "@/lib/api/architectures";
import { errorMessage } from "@/lib/api/client";
import {
  deleteGuestDesign,
  duplicateGuestDesign,
  GUEST_DESIGN_LIMIT,
  listGuestDesigns,
  renameGuestDesign,
} from "../playground/persistence/guestDesigns";

interface DesignRow {
  id: string;
  title: string;
  nodeCount: number;
  updatedAt: string;
}

interface DesignActions {
  rename(id: string, title: string): Promise<void>;
  duplicate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function DesignsPage() {
  const { status } = useAuth();
  if (status === "loading") return null;
  return status === "authenticated" ? <AccountDesigns /> : <GuestDesigns />;
}

function AccountDesigns() {
  const { data, isPending, error, refetch } = useArchitectureList();
  const rename = useRenameArchitecture();
  const duplicate = useDuplicateArchitecture();
  const remove = useDeleteArchitecture();

  const actions: DesignActions = {
    rename: async (id, title) => void (await rename.mutateAsync({ id, title })),
    duplicate: async (id) => void (await duplicate.mutateAsync(id)),
    remove: async (id) => void (await remove.mutateAsync(id)),
  };

  return (
    <DesignsLayout description="Designs saved to your account.">
      {isPending && (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>Couldn't load your designs</AlertTitle>
          <AlertDescription>
            {errorMessage(error)}
            <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={() => void refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data && <DesignList rows={data} actions={actions} />}
    </DesignsLayout>
  );
}

function GuestDesigns() {
  const [rows, setRows] = useState(listGuestDesigns);
  const refresh = () => setRows(listGuestDesigns());
  const actions: DesignActions = {
    rename: async (id, title) => {
      renameGuestDesign(id, title);
      refresh();
    },
    duplicate: async (id) => {
      if (rows.length >= GUEST_DESIGN_LIMIT || !duplicateGuestDesign(id)) {
        throw new Error(`This browser can hold at most ${GUEST_DESIGN_LIMIT} guest designs.`);
      }
      refresh();
    },
    remove: async (id) => {
      deleteGuestDesign(id);
      refresh();
    },
  };

  return (
    <DesignsLayout
      description={
        <>
          You're not signed in, so designs are saved in this browser only (up to {GUEST_DESIGN_LIMIT}).{" "}
          <Link to="/login?next=/designs" className="underline underline-offset-2">
            Sign in
          </Link>{" "}
          to move them to your account.
        </>
      }
    >
      <DesignList rows={rows} actions={actions} />
    </DesignsLayout>
  );
}

function DesignsLayout({
  description,
  children,
}: {
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">My designs</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild>
          <Link to="/playground">
            <Plus className="size-4" /> New design
          </Link>
        </Button>
      </header>
      {children}
    </div>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function DesignList({ rows, actions }: { rows: DesignRow[]; actions: DesignActions }) {
  const [renaming, setRenaming] = useState<DesignRow | null>(null);
  const [deleting, setDeleting] = useState<DesignRow | null>(null);

  const run = async (action: () => Promise<void>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={LayoutTemplate}
        title="No designs yet"
        description="Start a design in the playground: add components, connect them and define their flows."
        action={
          <Button size="sm" asChild>
            <Link to="/playground">Open the playground</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <ul className="divide-y rounded-lg border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link to={`/playground/${row.id}`} className="block truncate font-medium hover:underline">
                {row.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {row.nodeCount} component{row.nodeCount === 1 ? "" : "s"} · edited{" "}
                {dateFormat.format(new Date(row.updatedAt))}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={`Actions for ${row.title}`}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenaming(row)}>
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void run(() => actions.duplicate(row.id), `Duplicated "${row.title}"`)}
                >
                  <Copy /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(row)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

      <RenameDialog
        row={renaming}
        onClose={() => setRenaming(null)}
        onSave={(title) => {
          const row = renaming!;
          setRenaming(null);
          void run(() => actions.rename(row.id, title), "Renamed");
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the design. It can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const row = deleting!;
                setDeleting(null);
                void run(() => actions.remove(row.id), `Deleted "${row.title}"`);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RenameDialog({
  row,
  onClose,
  onSave,
}: {
  row: DesignRow | null;
  onClose(): void;
  onSave(title: string): void;
}) {
  const id = useId();
  const [title, setTitle] = useState("");
  return (
    <Dialog
      open={row !== null}
      onOpenChange={(open) => {
        if (open) setTitle(row?.title ?? "");
        else onClose();
      }}
    >
      <DialogContent onOpenAutoFocus={() => setTitle(row?.title ?? "")}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) onSave(title.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename design</DialogTitle>
            <DialogDescription>Give it a name you'll recognise later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={id}>Title</Label>
            <Input id={id} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
