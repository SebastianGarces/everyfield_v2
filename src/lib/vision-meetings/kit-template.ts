import type { ChecklistCategory } from "@/db/schema";

export interface KitTemplateItem {
  itemName: string;
  category: ChecklistCategory;
}

export const kitTemplate: KitTemplateItem[] = [
  { itemName: "Guest Sign-in Sheet", category: "essential" },
  { itemName: "Name Tags", category: "essential" },
  { itemName: "Response Cards", category: "essential" },
  { itemName: "Welcome Brochure", category: "materials" },
  { itemName: "Constitution/Doctrinal Brochure", category: "materials" },
  { itemName: "Business Cards", category: "materials" },
  { itemName: "Branded Pens", category: "materials" },
  { itemName: "Clipboards", category: "materials" },
  { itemName: "Markers", category: "materials" },
  { itemName: "Yard Signs", category: "setup" },
  { itemName: "4 Pillars Banner w/Stand", category: "setup" },
  { itemName: "Worship/Walk/Work Banner w/Stand", category: "setup" },
  { itemName: "Mission Statement Banner w/Stand", category: "setup" },
  { itemName: "Flash Drive", category: "av" },
  { itemName: "Extension Cord", category: "av" },
  { itemName: "Laptop Speakers", category: "av" },
  { itemName: "Content Boxes & Labels", category: "organization" },
  { itemName: "Portable Suitcase/Kit", category: "organization" },
];
