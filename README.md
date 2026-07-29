# Love King PRO Extension - Com Sistema de Licenciamento

Extensão para comunicação com o Lovable.dev, agora com sistema de licenciamento integrado.

## 🔐 Sistema de Licenças

A extensão agora requer uma licença válida para funcionar:

- **Ativação**: O usuário deve inserir uma chave de licença válida (formato: XXXXX-XXXXX-XXXXX-XXXXX)
- **Vinculação de Dispositivo**: Cada licença funciona em apenas 1 dispositivo
- **Validação Automática**: A licença é revalidada a cada 24 horas
- **Dias Restantes**: O usuário vê quantos dias faltam para expirar

### Status de Licença

- ✅ `valid` - Licença ativa e funcionando
- ❌ `expired` - Licença expirou, precisa renovar
- ❌ `revoked` - Licença foi cancelada pelo admin
- ❌ `device_mismatch` - Licença em uso em outro dispositivo
- ❌ `not_found` - Chave de licença inválida

## 🚀 Instalação

1. Abra `chrome://extensions` no Chrome
2. Ative o **Modo desenvolvedor**
3. Clique em **Carregar sem empacotar**
4. Selecione a pasta `public/extension`

## 📁 Estrutura

```
public/extension/
├── manifest.json    # Configuração da extensão
├── popup.html       # Interface com tela de licença
├── popup.js         # Lógica de licenciamento + app
├── README.md        # Esta documentação
└── icons/           # Ícones da extensão
    ├── logo.png
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## 🔧 API de Validação

A extensão usa a seguinte API para validar licenças:

```
POST https://rmetppilvfrxosvxzhgj.supabase.co/functions/v1/validate-license

Body:
{
  "license_key": "XXXXX-XXXXX-XXXXX-XXXXX",
  "hwid": "identificador-unico-do-dispositivo",
  "device_name": "nome-do-navegador"
}

Respostas:
- { "status": "valid", "days_remaining": 25 }
- { "status": "expired", "message": "License has expired" }
- { "status": "device_mismatch", "message": "License is already activated on another device" }
- { "status": "revoked", "message": "License has been revoked" }
- { "status": "not_found", "message": "License not found" }
```

## 🔒 Como Funciona o HWID

O Hardware ID é gerado automaticamente usando:
- User Agent do navegador
- Resolução da tela
- Timezone
- WebGL Renderer
- Número de núcleos do processador

O HWID é armazenado localmente e enviado na validação para garantir que a licença seja usada em apenas 1 dispositivo.

## 📝 Para Administradores

Use o painel admin em `/dashboard` para:
- Criar novas licenças
- Ver licenças ativas/expiradas
- Resetar dispositivo (permite nova ativação)
- Revogar licenças
- Renovar licenças
