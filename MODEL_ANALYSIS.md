# Model Capability Analysis — Routing Strategy

## Qwen3.6-27B (Local — Free)

### What it IS good at:
- **General coding**: Python, JavaScript, shell scripts, HTML/CSS — solid for everyday dev work
- **ML/DL concepts**: Trained on 36T tokens including heavy STEM/code data. Handles ML architecture discussions, model explanations, training concepts well
- **Data science**: Pandas, SQL, data manipulation, basic statistical analysis
- **System administration**: Linux, Docker, networking, AWS concepts
- **Multilingual**: 119 languages including strong Hindi/Indian language support
- **Instruction following**: Strong RL-tuned instruction following across 20+ general domains
- **Tool calling / agentic tasks**: Optimized for MCP and tool-use workflows
- **Thinking mode**: Hybrid thinking/non-thinking — can do chain-of-thought reasoning when enabled
- **Creative writing**: Decent for blogs, emails, documentation, technical writing
- **Math**: Good for standard algebra, calculus, probability — trained on synthetic math data

### Where it STRUGGLES (Q4 quantized, 27B params):
- **Very complex multi-step reasoning**: Deep chain-of-thought with 5+ reasoning steps degrades
- **Novel algorithm design**: Inventing new algorithms or architectures from scratch
- **Subtle code debugging**: Finding bugs in complex codebases with intertwined logic
- **Nuanced creative writing**: Literary quality, tone matching, highly polished prose
- **Very long context reasoning**: While it supports 128K context, quality degrades on needle-in-haystack tasks
- **Recent knowledge (post-training cutoff)**: Events after training data cutoff
- **Web search / real-time info**: No browsing capability
- **Edge cases in math**: Olympiad-level competition math, advanced proofs
- **High-stakes accuracy tasks**: Where wrong answers have real consequences
- **Multimodal reasoning**: Cannot process images/audio/video natively

### Q4 Quantization Impact:
- ~15-20% quality loss vs full precision on reasoning benchmarks
- More noticeable on math, code generation, and complex instruction following
- Fine for everyday tasks but degrades on tasks requiring precision

---

## Grok 4.5 (OpenRouter — Paid)

### What it excels at:
- **Advanced reasoning**: Deep multi-step reasoning with higher accuracy
- **Complex code generation**: Architecture-level design, novel algorithms, debugging complex systems
- **Math & science**: Competition-level math, proofs, advanced physics/chemistry
- **Real-time web knowledge**: Access to current information via X/Twitter integration
- **High-quality creative writing**: Literary polish, nuanced tone, sophisticated prose
- **Research synthesis**: Cross-domain analysis, literature review quality
- **Higher accuracy ceiling**: Less hallucination on factual queries
- **Long-context reasoning**: Better at maintaining coherence over very long outputs

### Cost consideration:
- Pay-per-token via OpenRouter
- Each routed request costs money
- Should ONLY be used when Qwen genuinely cannot deliver acceptable quality

---

## Routing Philosophy

**Default: LOCAL (Qwen3.6-27B)**
The local model handles ~80-90% of tasks perfectly fine. It's fast, free, and capable.

**Route to Grok 4.5 ONLY when:**
1. Task requires real-time/current information (web search)
2. Task requires very high reasoning depth (5+ logical steps, novel problem solving)
3. Task requires very high accuracy where mistakes are costly
4. User explicitly requests a stronger model
5. Task is genuinely outside Qwen's capability ceiling

**Key insight for Prateek's profile:**
As an ML engineer, most daily tasks (coding, debugging, ML concepts, AWS, system admin, data science) are well within Qwen's capability. Grok should be reserved for:
- Research-level analysis and synthesis
- Complex architecture decisions with trade-off analysis
- Novel algorithm design
- Tasks requiring current/recent information
- High-stakes technical writing (proposals, documentation for stakeholders)
