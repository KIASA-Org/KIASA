import type { Metadata } from "next";
import { CanopyPage } from "@/components/site/canopy";
import { canopy } from "@/content/canopy";

export const metadata: Metadata = { title: { absolute: canopy.name }, description: canopy.description };

export default function Canopy() {
  return <CanopyPage />;
}
