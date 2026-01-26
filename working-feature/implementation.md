# App Layout - Implementation Plan

**FRD:** `product-docs/features/wiki/frd.md` (for navigation requirements)
**Scope:** Initial layout with sidebar, ready for Wiki's hierarchical navigation

## Requirements Covered

- W-003: Hierarchical navigation with collapsible sections
- W-008: Breadcrumb navigation (structure prepared)
- UI/UX: Sticky side navigation on desktop, collapsible mobile navigation

## Implementation Steps

### Phase 1: Install shadcn Sidebar Component

- [x] Run `pnpm dlx shadcn@latest add sidebar` to install sidebar and dependencies
- [x] Verify sidebar component installed in `src/components/ui/`
- [x] Verify required dependencies (separator, tooltip, collapsible, breadcrumb, dropdown-menu, avatar) are installed

### Phase 2: Create App Sidebar Component

- [x] Create `src/components/app-sidebar.tsx` - main sidebar component
- [x] Create `src/components/nav-main.tsx` - primary navigation with collapsible sections
- [x] Create `src/components/nav-user.tsx` - user menu in sidebar footer

### Phase 3: Update Dashboard Layout

- [x] Update `src/app/(dashboard)/layout.tsx` with SidebarProvider and structure
- [x] Add SidebarInset for main content area
- [x] Add header with SidebarTrigger and breadcrumb placeholder
- [x] Implement cookie-based sidebar state persistence

### Phase 4: Define Navigation Data

- [x] Navigation data already existed in `src/lib/navigation.ts`
- [x] Structure navigation to support Wiki's deep hierarchy (already done)
- [x] Add icons for each navigation section (using lucide-react) (already done)

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `src/components/ui/sidebar.tsx` | Create (via CLI) | shadcn sidebar component |
| `src/components/ui/separator.tsx` | Create (via CLI) | Required by sidebar |
| `src/components/ui/tooltip.tsx` | Create (via CLI) | Required by sidebar |
| `src/components/ui/sheet.tsx` | Create (via CLI) | Required for mobile sidebar |
| `src/components/ui/skeleton.tsx` | Create (via CLI) | For loading states |
| `src/components/app-sidebar.tsx` | Create | Main app sidebar |
| `src/components/nav-main.tsx` | Create | Primary navigation component |
| `src/components/nav-user.tsx` | Create | User menu component |
| `src/app/(dashboard)/layout.tsx` | Modify | Add sidebar provider and structure |
| `src/lib/navigation.ts` | Modify | Add navigation types and data |

## Navigation Data Structure

```typescript
type NavItem = {
  title: string
  url: string
  icon: LucideIcon
  isActive?: boolean
  items?: {
    title: string
    url: string
    items?: { title: string; url: string }[] // For wiki's deep nesting
  }[]
}
```

## Sidebar Structure

```
┌─────────────────────────────┐
│  SidebarHeader              │
│  ├── App Logo/Name          │
│  └── Church Switcher (TBD)  │
├─────────────────────────────┤
│  SidebarContent             │
│  ├── SidebarGroup: Main     │
│  │   ├── Dashboard          │
│  │   ├── Wiki (collapsible) │
│  │   │   ├── The Journey    │
│  │   │   ├── Reference      │
│  │   │   └── Resources      │
│  │   ├── People             │
│  │   ├── Vision Meetings    │
│  │   └── ...                │
│  └── SidebarGroup: Settings │
│      └── Settings           │
├─────────────────────────────┤
│  SidebarFooter              │
│  └── User Menu (dropdown)   │
└─────────────────────────────┘
```

## Layout Structure

```
┌─────────────────────────────────────────────┐
│  SidebarProvider                            │
│  ├── AppSidebar                             │
│  └── SidebarInset                           │
│      ├── header (SidebarTrigger + Breadcrumb│
│      └── main (children)                    │
└─────────────────────────────────────────────┘
```
