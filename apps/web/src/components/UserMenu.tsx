import { LogOut, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/authContext";
import { useMe } from "@/lib/api/me";
import { initials } from "@/lib/initials";

export function UserMenu() {
  const { session, signOut } = useAuth();
  const { data: me } = useMe();
  const navigate = useNavigate();

  // Until /api/me answers, fall back to what the session already knows.
  const name = me?.displayName ?? session?.user.email ?? "Account";
  const email = me?.email ?? session?.user.email ?? "";

  async function handleSignOut() {
    await signOut();
    toast.success("Signed out");
    navigate("/", { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-7">
            {me?.avatarUrl && <AvatarImage src={me.avatarUrl} alt="" />}
            <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="grid">
          <span className="truncate">{name}</span>
          {email && <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserRound className="size-4" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleSignOut()}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
