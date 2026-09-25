export function ColorAlphaField({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) {
  const hex = value.slice(0, 7) || "#000000";
  const alphaHex = value.slice(7, 9) || "FF";
  const alpha = isNaN(parseInt(alphaHex, 16)) ? 255 : parseInt(alphaHex, 16);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value + alphaHex);
  };
  const handleAlphaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newAlphaHex = parseInt(e.target.value).toString(16).padStart(2, "0").toUpperCase();
    onChange(hex + newAlphaHex);
  };

  return (
    <label className="field" style={{ display: "flex", flexDirection: "column" }}>
      <span>{label} (不透明度: {Math.round(alpha/255*100)}%)</span>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
        <input type="color" value={hex} onChange={handleColorChange} style={{ width: "32px", height: "24px", padding: 0, border: "none" }} />
        <input type="range" min={0} max={255} value={alpha} onChange={handleAlphaChange} style={{ flex: 1 }} />
      </div>
    </label>
  );
}
