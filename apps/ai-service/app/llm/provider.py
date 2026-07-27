import logging
from app.config import settings

logger = logging.getLogger(__name__)

async def llm_complete(prompt: str, system: str = "You are a helpful construction AI assistant.", max_tokens: int = 1024, provider: str = None) -> str:
    p = provider or settings.default_llm_provider
    if p == "anthropic" and settings.anthropic_api_key:
        return await _anthropic(prompt, system, max_tokens)
    if p == "openai" and settings.openai_api_key:
        return await _openai(prompt, system, max_tokens)
    return await _ollama(prompt, system, max_tokens)

async def _anthropic(prompt, system, max_tokens):
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    msg = await client.messages.create(
        model="claude-sonnet-4-6", max_tokens=max_tokens,
        system=system, messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text

async def _openai(prompt, system, max_tokens):
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    resp = await client.chat.completions.create(
        model="gpt-4o", max_tokens=max_tokens,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
    )
    return resp.choices[0].message.content or ""

async def _ollama(prompt, system, max_tokens):
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.ollama_url}/api/generate",
            json={"model": "llama3", "prompt": f"{system}\n\n{prompt}", "stream": False},
            timeout=120,
        )
    return resp.json().get("response", "")
