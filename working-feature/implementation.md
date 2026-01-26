# User Sidenav Dropdown Fixes - Implementation Plan

**FRD:** N/A (Bug fix / behavior correction)
**Scope:** Fix logout functionality and pass real user data

## Requirements Covered

1. Replace logout Link with actual logout server action call
2. Pass authenticated user data to AppSidebar component
3. Display user's actual name and email in the dropdown

## Implementation Steps

### Phase 1: Fix Logout Functionality

- [x] Update `nav-user.tsx` to import the `logout` server action
- [x] Replace the `<Link href="/logout">` with a form that calls the logout action
- [x] Use a form with server action (proper pattern for mutations)

### Phase 2: Pass User Data to Sidebar

- [x] Update dashboard layout to fetch current session/user
- [x] Update `AppSidebar` to accept user prop
- [x] Remove placeholder user data from `app-sidebar.tsx`
- [x] Create helper function to generate initials from name/email

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/components/nav-user.tsx` | Modify | Replace logout Link with form calling server action |
| `src/components/app-sidebar.tsx` | Modify | Accept user prop, remove placeholder data |
| `src/app/(dashboard)/layout.tsx` | Modify | Fetch user session and pass to AppSidebar |

## Components

### NavUser Props (updated)

```typescript
type NavUserProps = {
  user: {
    name: string;
    email: string;
    initials: string;
  };
};
```

### AppSidebar Props (new)

```typescript
type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: {
    name: string;
    email: string;
    initials: string;
  };
};
```

## Helper Function

```typescript
function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  return email.substring(0, 2).toUpperCase();
}
```
