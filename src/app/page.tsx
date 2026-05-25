"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useExcelStore } from "@/lib/store";
import { Landing } from "@/components/Landing";

export default function Home() {
  const { data } = useExcelStore();
  const router = useRouter();

  useEffect(() => {
    if (data) router.replace("/dashboard");
  }, [data, router]);

  if (data) return null;
  return <Landing />;
}
