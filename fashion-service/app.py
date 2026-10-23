"""Small FashionCLIP API for Remy.

The model is loaded once when the service starts. Remy can call /embed when a
wardrobe item is uploaded and store the returned vector in Supabase.
"""

import base64
import io
import os
from functools import lru_cache
from typing import Any

import httpx
import numpy as np
import torch
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image
from transformers import CLIPModel, CLIPProcessor


MODEL_NAME = os.getenv("FASHIONCLIP_MODEL", "patrickjohncyh/fashion-clip")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
API_KEY = os.getenv("FASHION_API_KEY", "")

app = FastAPI(title="Remy Fashion Vision API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOW_ORIGINS", "*").split(","),
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


class ImageUrlRequest(BaseModel):
    image_url: str | None = None
    image_base64: str | None = None
    texts: list[str] = Field(default_factory=list)


def require_api_key(header: str | None) -> None:
    if API_KEY and header != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Fashion API key")


@lru_cache(maxsize=1)
def get_model() -> tuple[CLIPModel, CLIPProcessor]:
    processor = CLIPProcessor.from_pretrained(MODEL_NAME)
    model = CLIPModel.from_pretrained(MODEL_NAME)
    model.eval()
    return model, processor


def open_image(raw: bytes) -> Image.Image:
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be smaller than 10MB")
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid image") from error


async def read_request_image(payload: ImageUrlRequest) -> Image.Image:
    if payload.image_base64:
        try:
            encoded = payload.image_base64.split(",", 1)[-1]
            return open_image(base64.b64decode(encoded))
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=400, detail="Invalid base64 image") from error
    if payload.image_url:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(payload.image_url)
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Could not download image")
        return open_image(response.content)
    raise HTTPException(status_code=400, detail="Provide image_url or image_base64")


def encode(image: Image.Image, texts: list[str]) -> dict[str, Any]:
    model, processor = get_model()
    with torch.inference_mode():
        image_inputs = processor(images=image, return_tensors="pt")
        image_vector = model.get_image_features(**image_inputs)
        image_vector = image_vector / image_vector.norm(dim=-1, keepdim=True)
        result: dict[str, Any] = {
            "model": MODEL_NAME,
            "embedding": image_vector[0].cpu().tolist(),
        }
        if texts:
            text_inputs = processor(text=texts, return_tensors="pt", padding=True, truncation=True)
            text_vectors = model.get_text_features(**text_inputs)
            text_vectors = text_vectors / text_vectors.norm(dim=-1, keepdim=True)
            result["text_matches"] = [
                {"text": text, "score": float((image_vector @ text_vector.unsqueeze(-1)).item())}
                for text, text_vector in zip(texts, text_vectors)
            ]
        return result


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/embed")
async def embed(payload: ImageUrlRequest, x_fashion_key: str | None = Header(default=None)) -> dict[str, Any]:
    require_api_key(x_fashion_key)
    return encode(await read_request_image(payload), payload.texts)


@app.post("/embed-upload")
async def embed_upload(file: UploadFile = File(...), x_fashion_key: str | None = Header(default=None)) -> dict[str, Any]:
    require_api_key(x_fashion_key)
    raw = await file.read(MAX_IMAGE_BYTES + 1)
    return encode(open_image(raw), [])
