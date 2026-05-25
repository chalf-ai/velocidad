import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const out = readFileSync("/Users/Daviid/Library/CloudStorage/OneDrive-pompeyo.cl/Claude One Drive/Cruce Capital Trabajo.xlsx");
const wb = XLSX.read(out, { type: "buffer" });
const noMatch = XLSX.utils.sheet_to_json(wb.Sheets["VIN_No_Cruzados"]);
for (const r of noMatch) console.log(JSON.stringify(r, null, 2));
