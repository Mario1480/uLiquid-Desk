# Ein UI route inventory

Source inventory of 107 page files. Locale prefixes and dynamic parameters use these same pages; existing redirects and catch-all mappings are unchanged. This is not a claim of manual acceptance of every data-bearing state.

Native adapters preserve events, precision, mounting, sorting and scroll ownership. Existing charts, order books, calendar logic, query controllers and specialized tab controllers are deliberately retained. Shared Ocean shell, avatar, breadcrumb and tooltip apply independently of each page.

| Route | Adapters in page dependency graph | Retained behavior / exception |
|---|---|---|
| `/accounts` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/access-section` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/affiliate` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/ai-prompts` | `Button`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/ai-trace` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/alerts` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/api-keys` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/audit` | `Button`, `Input`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/billing` | `Button`, `Dialog`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/bots` | `Button`, `Input`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/exchanges` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/grid-hyperliquid-pilot` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/grid-templates/[id]` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/grid-templates` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/indicator-settings` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/legacy/[...slug]` | `Button`, `Dialog`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/legacy/grid-templates/[id]` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/legacy` | Shared tokens / target | Static legal/document content; shared Ocean tokens and solid link buttons apply. |
| `/admin/licenses/packages` | `Button`, `Dialog`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/licenses` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/prediction-defaults` | `Button`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/prediction-refresh` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/providers` | `Button`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/runners` | `Button`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/server-info` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/smtp` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/statistics` | `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies/ai` | `Button`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies/ai-generator` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies/builder` | `Button`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies/local` | `Button`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies` | Shared tokens / target | Redirect only; target is migrated. |
| `/admin/system/[...slug]` | `Button`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/ai/grid-templates/[id]` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/ai/grid-templates` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/bots/grid-templates/[id]` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/bots/grid-templates` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system` | `Button`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/ui-components` | `Button`, `Dialog`, `Input`, `Select`, `Textarea` | Protected noindex gallery; local fixtures only. |
| `/admin/telegram` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/uliq` | `Button`, `Dialog`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/users/[id]` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/users` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/vault-execution` | `Button`, `Input`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/vault-operations` | `Button`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/vault-safety` | `Button`, `Input`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/workspaces/[id]` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/workspaces` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/agent-chat` | `Button`, `Dialog`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/[id]` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/[id]/price-support` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/[id]/settings` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/catalog/new` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/catalog` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/grid/[instanceId]` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/grid/new` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/grid` | `Button`, `Dialog`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/new` | `Button`, `Dialog`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/bots` | `Button`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/calendar` | `Button`, `Input`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/cookies` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/dashboard` | `Button`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/funding/history` | Shared tokens / target | Redirect only; target is migrated. |
| `/funding` | Shared tokens / target | Redirect only; target is migrated. |
| `/help` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/login` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/maintenance` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/market-intelligence` | `Button`, `Dialog`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/news` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/` | `Button`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/predictions` | `Button`, `Dialog`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/presale` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/presale/terms` | Shared tokens / target | Static legal/document content; shared Ocean tokens and solid link buttons apply. |
| `/presale/vesting` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/privacy` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/register` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/reset-password` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/risk-disclosure` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/affiliate` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/audit` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/bot-vaults` | `Button`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/exchange-accounts` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/global-defaults` | `Button`, `Input`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/notifications` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings` | `Button`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/privacy` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/risk` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/roles` | `Button`, `Dialog`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/security` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/setup` | `Button`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/subscription/order` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/subscription` | `Button`, `Input`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/trading-defaults` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/users` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/strategies` | `Button`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/terms` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/trade` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/trading-desk` | `Button`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/uliq/locking` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/uliq` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/uliq/presale` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/uliq/vesting` | `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/vaults/[vaultAddress]` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/vaults` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/wallet/history` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/wallet` | `Button`, `Dialog`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
