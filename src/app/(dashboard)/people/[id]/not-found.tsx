import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function PersonNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h2 className="text-2xl font-bold">Person Not Found</h2>
      <p className="text-muted-foreground">
        The person you&apos;re looking for doesn&apos;t exist or has been
        deleted.
      </p>
      <Button asChild>
        <Link href="/people">Back to People</Link>
      </Button>
    </div>
  );
}
