# Remy Fashion Vision API

This service runs FashionCLIP separately from the React/Vite app. It is
intended to be deployed as a small FastAPI service.

## Run locally

```powershell
cd fashion-service
py -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
$env:FASHION_API_KEY = "change-this-local-key"
uvicorn app:app --reload --port 8000
```

The first request downloads the FashionCLIP checkpoint from Hugging Face.

## Test it

```powershell
curl.exe http://127.0.0.1:8000/health
curl.exe -X POST http://127.0.0.1:8000/embed `
  -H "Content-Type: application/json" `
  -H "X-Fashion-Key: change-this-local-key" `
  -d '{"image_url":"https://your-public-image-url/image.jpg","texts":["a light summer shirt","a heavy winter hoodie"]}'
```

## Production configuration

Set these environment variables in the hosting service:

- `FASHION_API_KEY`: a long random secret
- `ALLOW_ORIGINS`: the Remy frontend origin, not `*`
- `FASHIONCLIP_MODEL`: optional model override

Call `/embed` once when a wardrobe image is uploaded, store the returned
`embedding` with that wardrobe item, and reuse it for outfit matching.
