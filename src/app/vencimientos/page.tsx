import { PlaceholderPage } from "@/components/PlaceholderPage";

export default function Page() {
  return (
    <PlaceholderPage
      title="Vencimientos"
      description="Vehículos financiados con vencimientos próximos y vencidos."
      bullets={[
        "Vencidos (acción inmediata)",
        "Próximos 30 días",
        "Próximos 60-90 días",
        "Calendario por mes",
        "Drill por marca / financiera",
      ]}
    />
  );
}
