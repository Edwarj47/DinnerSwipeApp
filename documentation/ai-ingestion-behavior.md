# AI Ingestion Behavior

AI normalization is optional and disabled by default.

When enabled, `OpenAIResponsesProvider` calls the OpenAI Responses API using structured JSON schema output and `store: false`. The prompt instructs the model to normalize only fields present in the candidate and not invent ingredients, instructions, timing, source, or images.

Stored provenance includes the model, prompt version, extraction timestamp, confidence data, warnings, and field-source metadata where available.

The adapter never approves recipes. URL-ingested candidates remain in review until the user explicitly approves them.

