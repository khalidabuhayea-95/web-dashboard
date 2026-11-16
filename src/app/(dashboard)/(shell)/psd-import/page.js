import PsdImportClient from "./PsdImportClient";

export const metadata = {
  title: "PSD Import",
  description: "Convert Photoshop (PSD) templates into editable mobile-template layers",
};

export default function PsdImportPage() {
  return <PsdImportClient />;
}
