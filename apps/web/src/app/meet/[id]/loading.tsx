import { PageLoading } from "@/components/site/page-loading";

/** Shown the moment the meeting is asked for, while the server makes it. */
export default function Loading() {
  return <PageLoading label="Meeting" kind="admin" />;
}
