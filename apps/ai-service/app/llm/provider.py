import logging
from app.config import settings

logger = logging.getLogger(__name__)

async def llm_complete(prompt: str, system: str = "You are a helpful construction AI assistant.", max_tokens: int = 1024, provider: str = None) -> str:
    p = provider or settings.default_llm_provider
    last_error: Exception | None = None

    if p == "anthropic" and settings.anthropic_api_key:
        try:
            return await _anthropic(prompt, system, max_tokens)
        except Exception as e:
            logger.warning(f"LLM provider 'anthropic' failed, falling back: {e}")
            last_error = e
    elif p == "openai" and settings.openai_api_key:
        try:
            return await _openai(prompt, system, max_tokens)
        except Exception as e:
            logger.warning(f"LLM provider 'openai' failed, falling back: {e}")
            last_error = e

    try:
        return await _omniroute(prompt, system, max_tokens)
    except Exception as e:
        logger.warning(f"LLM provider 'omniroute' failed, falling back: {e}")
        last_error = e

    try:
        return await _ollama(prompt, system, max_tokens)
    except Exception as e:
        logger.error(f"LLM provider 'ollama' failed; no providers left: {e}")
        last_error = e

    raise last_error

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

async def _omniroute(prompt, system, max_tokens):
    # Local dev-only free-tier AI gateway (OpenAI-compatible), not auto-started
    # and not available outside this machine -- see .env.example. The OpenAI
    # SDK requires a non-empty api_key even though OmniRoute doesn't check it.
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key="omniroute-local", base_url=settings.omniroute_base_url)
    resp = await client.chat.completions.create(
        model=settings.omniroute_model, max_tokens=max_tokens,
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
