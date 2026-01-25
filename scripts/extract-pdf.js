import fs from "fs";
import { PDFParse } from "pdf-parse";

async function extractPDF() {
  try {
    const dataBuffer = fs.readFileSync("product-docs/Launch-Playbook.pdf");
    const parser = new PDFParse({ data: dataBuffer });

    // Get document info
    const info = await parser.getInfo();
    console.log("Number of pages:", info.total);
    console.log("Info:", JSON.stringify(info.info, null, 2));

    // Get text content
    console.log("\n--- TEXT CONTENT ---\n");
    const textResult = await parser.getText();
    console.log(textResult.text);

    await parser.destroy();
  } catch (err) {
    console.error("Error:", err);
  }
}

extractPDF();
