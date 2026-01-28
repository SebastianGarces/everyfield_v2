import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">EveryField</h1>
        <p className="mb-6 text-lg text-gray-600">
          Church Planting Management Platform
        </p>
        <div className="flex gap-3 justify-center">
          <Button asChild>
            <Link href="/login">Login</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/register">Register</Link>
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground uppercase tracking-wide">Development preview</p>
      </div>
    </div>
  );
}
