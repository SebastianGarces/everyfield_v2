"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Church } from "lucide-react";
import { useActionState } from "react";
import { createChurch, type CreateChurchState } from "./actions";

const initialState: CreateChurchState = {};

export function CreateChurchCard() {
  const [state, formAction, pending] = useActionState(
    createChurch,
    initialState
  );

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
            <Church className="text-primary h-5 w-5" />
          </div>
          <div>
            <CardTitle>Create your church plant</CardTitle>
            <CardDescription>
              Ready to get started? Name your church plant to unlock all
              features.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
              {state.error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="church-name">Church plant name</Label>
            <Input
              id="church-name"
              name="name"
              type="text"
              placeholder="e.g., Grace Community Church"
              required
              aria-invalid={!!state.fieldErrors?.name}
            />
            {state.fieldErrors?.name && (
              <p className="text-destructive text-sm">
                {state.fieldErrors.name}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full cursor-pointer"
            disabled={pending}
          >
            {pending ? "Creating..." : "Create church plant"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
