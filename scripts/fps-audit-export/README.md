# Teste de FPS/Screen Share — Máquina B (Fase 7.6)

Este teste **não acessa o Supabase, não faz login, não toca em banco de dados** — só conecta direto no LiveKit Cloud do projeto Dexy pra medir FPS/bitrate reais de compartilhamento de tela, usando o `livekit-client` real do projeto.

## Requisitos

- Windows (qualquer versão).
- [Node.js LTS](https://nodejs.org) instalado.
- Google Chrome instalado (o normal, não precisa ser nenhuma versão específica).
- Esta pasta inteira (`fps-audit-export/`), copiada como está.

## Passo a passo

1. **Preencher as credenciais.** Copie `.env.example` para `.env` (mesma pasta) e peça pra quem te mandou esta pasta os 3 valores (`VITE_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). Não precisa de mais nada.

2. **Instalar dependências** (abra um terminal/PowerShell dentro desta pasta):
   ```
   npm install
   npx playwright install chromium
   ```

3. **Coletar informações do computador** (gera 2 arquivos automaticamente):
   ```
   powershell -ExecutionPolicy Bypass -File collect-env-info.ps1
   node collect-chrome-gpu.mjs
   ```
   Isso cria `env-info-maquinaB.txt` (Windows/CPU/GPU/driver) e `chrome-gpu-maquinaB.png` (status de aceleração de hardware do Chrome).

4. **Rodar o teste decisivo** — vai abrir janelas do Chrome sozinho, sem precisar clicar em nada (totalmente automatizado):
   ```
   node decisive-test.mjs
   ```
   Isso roda automaticamente os 4 cenários obrigatórios:
   - Aba + canvas, 1080p60
   - Aba + canvas, 720p60
   - Aba + canvas, 1080p120
   - Tela inteira + canvas, 1080p60

   Leva uns 4-5 minutos. Janelas do Chrome vão abrir e fechar sozinhas várias vezes — normal, não precisa mexer em nada.

   **O que esse teste mede, especificamente:** para cada cenário, ele captura a tela **uma única vez** e mede a **mesma `MediaStreamTrack`** em 5 pontos sem nunca recriar a captura: (1) FPS bruto antes de qualquer WebRTC existir, (2) a mesma track enquanto está sendo publicada via LiveKit, (3) `outbound-rtp.framesEncoded`, (4) `inbound-rtp.framesDecoded`, (5) FPS renderizado do lado que assina. No final imprime um resumo assim:

   ```
   cenário            capture    track+webrtc   outbound   inbound    render
   tab_1080p60        60.0       ???            ???        ???        ???
   tab_720p60         60.0       ???            ???        ???        ???
   tab_1080p120       117.0      ???            ???        ???        ???
   screen_1080p60     ???        ???            ???        ???        ???
   ```

   Se rodar mais de uma vez (ex: pra conferir consistência), cada execução grava por cima do mesmo arquivo de resultado — copie/renomeie `results/decisive-maquinaB.json` entre execuções se quiser guardar mais de uma rodada.

   (Também existe `runner.mjs compare`, um teste anterior/mais simples com cenários parecidos — não é o que precisamos agora, pode ignorar.)

## O que enviar de volta

- A saída completa do terminal do passo 4 (incluindo o bloco "RESUMO" no final — pode copiar e colar tudo).
- A pasta `results/` inteira (criada automaticamente pelo teste — principalmente `decisive-maquinaB.json`).
- `env-info-maquinaB.txt`.
- `chrome-gpu-maquinaB.png`.

## Aviso de segurança

O arquivo `.env` desta pasta contém uma credencial (`LIVEKIT_API_SECRET`) que permite criar/entrar em qualquer sala do projeto LiveKit do Dexy. Depois do teste, apague o `.env` desta máquina se ela não for de confiança total.
