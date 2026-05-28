import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// High limit because images are sent as Base64 strings
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

function getAiClient(customApiKey?: string): GoogleGenAI {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 입력되지 않았거나 정의되지 않았습니다. 화면 상부 입력창에 API Key를 기입하세요.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Health status check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Proxy and return external image as Base64 to bypass CORS in preview environments
app.get("/api/proxy-image", async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ error: "Missing 'url' query parameter" });
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    
    return res.json({
      success: true,
      data: buffer.toString("base64"),
      mimeType
    });
  } catch (err: any) {
    console.error("Proxy error:", err);
    return res.status(500).json({ success: false, error: err.message || "Failed to proxy image" });
  }
});

// Architectural design AI modifier endpoint
app.post("/api/edit-image", async (req, res) => {
  try {
    const { originalImage, originalMimeType, referenceImage, referenceMimeType, prompt } = req.body;

    if (!originalImage) {
      return res.status(400).json({ success: false, error: "Original image is required." });
    }

    const customApiKey = req.headers["x-gemini-api-key"] as string;
    const ai = getAiClient(customApiKey);
    const parts: any[] = [];

    // Add original image (Defensively split in case client sends a full Data URL)
    const cleanOriginal = originalImage.includes(",") ? originalImage.split(",")[1] : originalImage;
    parts.push({
      inlineData: {
        data: cleanOriginal,
        mimeType: originalMimeType || "image/png"
      }
    });

    // Add optional styling reference image
    if (referenceImage) {
      const cleanRef = referenceImage.includes(",") ? referenceImage.split(",")[1] : referenceImage;
      parts.push({
        inlineData: {
          data: cleanRef,
          mimeType: referenceMimeType || "image/png"
        }
      });
    }

    // Build the structural prompt adhering to client core directives and expectations
    const structuralPrompt = `When editing the uploaded architectural image, preserve the original building structure, perspective, massing, and main architectural elements unless the user explicitly requests otherwise. Apply the user’s edit request carefully. If a reference image is provided, use it only as visual style guidance for material, mood, lighting, color palette, and architectural atmosphere. Do not replace the original building with the reference image. Produce a realistic, high-quality architectural visualization suitable for client presentation.

User Request (In Korean):
"${prompt || "내용을 입력하지 않으면 원본 형태를 그대로 유지합니다. (Enhance visual polish, materials, and realism)"}"

Always deliver a single edited image matching this direction.`;

    parts.push({ text: structuralPrompt });

    console.log("Generating visual changes using gemini-2.5-flash-image...");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: { parts }
    });

    let resultBase64 = "";
    const responseParts = response.candidates?.[0]?.content?.parts;

    if (responseParts) {
      for (const part of responseParts) {
        if (part.inlineData) {
          resultBase64 = `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!resultBase64) {
      throw new Error("AI did not produce an image output. Please make sure the input images are valid and the prompt follows guidelines.");
    }

    return res.json({ success: true, resultImage: resultBase64 });

  } catch (err: any) {
    console.error("AI edit operation failed:", err);
    const errMsg = err.message || "Failed to process image editing";
    const isQuotaError = errMsg.includes("Quota") || errMsg.includes("exhausted") || errMsg.includes("limit") || errMsg.includes("RESOURCE_EXHAUSTED");
    return res.status(200).json({ 
      success: false, 
      error: errMsg, 
      isQuotaError 
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ARCH-VISION server running in ${isProd ? "production" : "development"} mode on port ${PORT}`);
  });
}

startServer();
