# Data Patterns

## Core Principles

1. **Never store server data in useState** - This is an anti-pattern that leads to stale data
2. **Never use useEffect for data synchronization** - useEffect is for side effects (subscriptions, DOM manipulation), not data
3. **Use useOptimistic for instant UI feedback** - React's built-in hook for optimistic updates
4. **Server actions call refresh() to sync state** - The server triggers client router refresh

## Recommended Pattern: useOptimistic + refresh()

For mutations that need instant UI feedback:

```tsx
// Server Action - calls refresh() to sync client state
'use server';
import { refresh } from 'next/cache';

export async function addItemAction(data) {
  await db.insert(items).values(data);
  refresh(); // Triggers client router refresh
}
```

```tsx
// Client Component - uses useOptimistic for instant feedback
'use client';
import { useOptimistic, useTransition } from 'react';

function ItemList({ items }) {
  const [isPending, startTransition] = useTransition();
  
  // useOptimistic takes server state and a reducer
  const [optimisticItems, updateOptimistic] = useOptimistic(
    items,
    (state, newItem) => [newItem, ...state]
  );
  
  const handleAdd = async (data) => {
    startTransition(async () => {
      // Instant UI update
      updateOptimistic({ id: 'temp', ...data });
      // Server action calls refresh() to reconcile
      await addItemAction(data);
    });
  };
  
  return (
    <>
      <AddForm onAdd={handleAdd} isPending={isPending} />
      <List items={optimisticItems} />
    </>
  );
}
```

## When Client State IS Appropriate

Client state is valid for:
- **UI state** - modals, dropdowns, form inputs
- **Pagination cursors** - tracking "load more" position
- **Drag-and-drop** - temporary visual state during drag

Client state is NOT valid for:
- **Server data** - always use props from server components
- **Syncing with props** - never `useEffect(() => setState(prop), [prop])`

## Pattern Examples

### Activity Timeline (useOptimistic)
- `ActivityTimelineClient` - Owns optimistic state for add/delete
- `ActivityFeed` - Receives activities as props, uses useOptimistic for delete
- `NoteForm` - Calls parent handler which triggers optimistic update

### Pipeline View (Legitimate Client State)
- Uses useState for drag-and-drop visual state
- Server action calls refresh() after status change
- useOptimistic would also work here

### Tag Picker (Props Only)
- No local state - uses props directly
- Server action calls refresh() after mutation
- Parent re-renders with new props

## Server Action Patterns

```tsx
// Use refresh() for mutations that affect current page
export async function addNoteAction(personId, note) {
  await db.insert(activities).values({ personId, note });
  refresh(); // Refreshes client router
}

// Use revalidatePath() for mutations that affect other pages
export async function createPersonAction(data) {
  await db.insert(persons).values(data);
  revalidatePath('/people'); // Revalidates people list
}
```

## Invariants

1. **Server data flows through props** - Server components fetch, client components receive
2. **useOptimistic for instant feedback** - Not useState + manual updates
3. **Server actions call refresh()** - Not client calling router.refresh()
4. **useEffect is for side effects only** - Subscriptions, DOM, external systems
