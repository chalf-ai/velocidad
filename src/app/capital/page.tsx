import { PlaceholderPage } from "@/components/PlaceholderPage";

export default function Page() {
  return (
    <PlaceholderPage
      title="Capital de Trabajo"
      description="Capital propio + PP comprometido por marca, con ranking de problemas."
      bullets={[
        "Autos pagados (capital sin retorno)",
        "Autos financiados vencidos",
        "Stock sin rotación ≥60 días",
        "Capital atrapado por marca",
        "Capital PP comprometido por marca (vehículos puente)",
        "Ranking de marcas con más capital atrapado",
      ]}
    />
  );
}
