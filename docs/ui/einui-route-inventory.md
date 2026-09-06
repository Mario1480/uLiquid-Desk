# Ein UI route inventory

Source inventory of 107 page files. Locale prefixes and dynamic parameters use these same pages; existing redirects and catch-all mappings are unchanged. This is not a claim of manual acceptance of every data-bearing state.

Ein controls and compatibility adapters preserve existing form values, precision, mounting, sorting and scroll ownership. Select uses an invisible native form bridge and a visible Radix/Ein trigger; checkbox, switch, radio and slider use their actual Ein primitives. Existing charts, order books, calendar logic, query controllers and specialized tab controllers are deliberately retained. Shared Ocean shell, avatar, breadcrumb and tooltip apply independently of each page.

| Route | Adapters in page dependency graph | Retained behavior / exception |
|---|---|---|
| `/accounts` | `Badge`, `Button`, `Checkbox`, `Input`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/access-section` | `Button`, `Input`, `Link`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/affiliate` | `Button`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/ai-prompts` | `Button`, `Checkbox`, `Input`, `Select`, `Surface`, `Switch`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/ai-trace` | `Button`, `Input`, `Link`, `Select`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/alerts` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/api-keys` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/audit` | `Button`, `Input`, `Link`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/billing` | `Badge`, `Button`, `Dialog`, `Input`, `Link`, `Select`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/bots` | `Badge`, `Button`, `Input`, `Link`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/exchanges` | `Button`, `Input`, `Link`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/grid-hyperliquid-pilot` | `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/grid-templates/[id]` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/grid-templates` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/indicator-settings` | `Badge`, `Button`, `Checkbox`, `Input`, `Select`, `Surface`, `Switch`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/legacy/[...slug]` | `Badge`, `Button`, `Checkbox`, `Dialog`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/legacy/grid-templates/[id]` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/legacy` | `Link` | Static legal/document content; shared Ocean tokens and solid link buttons apply. |
| `/admin/licenses/packages` | `Badge`, `Button`, `Dialog`, `Input`, `Link`, `Select`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/licenses` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin` | `Badge`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/prediction-defaults` | `Button`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/prediction-refresh` | `Button`, `Input`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/providers` | `Badge`, `Button`, `Link`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/runners` | `Badge`, `Button`, `Link`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/server-info` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/smtp` | `Button`, `Checkbox`, `Input`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/statistics` | `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies/ai` | `Button`, `Checkbox`, `Input`, `Select`, `Surface`, `Switch`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies/ai-generator` | `Button`, `Checkbox`, `Input`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies/builder` | `Button`, `Input`, `Select`, `Surface`, `Switch`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies/local` | `Button`, `Checkbox`, `Input`, `Select`, `Surface`, `Switch`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/strategies` |  | Redirect only; target is migrated. |
| `/admin/system/[...slug]` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/ai/grid-templates/[id]` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/ai/grid-templates` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/bots/grid-templates/[id]` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/bots/grid-templates` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system` | `Button`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/system/ui-components` | `Button`, `Checkbox`, `Dialog`, `Input`, `Select`, `Switch`, `Textarea` | Protected noindex gallery; local fixtures only. |
| `/admin/telegram` | `Button`, `Input`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/uliq` | `Badge`, `Button`, `Checkbox`, `Dialog`, `Input`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/users/[id]` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/users` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/vault-execution` | `Button`, `Input`, `Link`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/vault-operations` | `Badge`, `Button`, `Link`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/vault-safety` | `Button`, `Input`, `Link`, `Surface`, `Switch`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/workspaces/[id]` | `Badge`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/admin/workspaces` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/agent-chat` | `Badge`, `Button`, `Dialog`, `Input`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/[id]` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/[id]/price-support` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/[id]/settings` | `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/catalog/new` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/catalog` | `Badge`, `Button`, `Checkbox`, `ChoiceGroup`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/grid/[instanceId]` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/grid/new` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/grid` | `Badge`, `Button`, `Dialog`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/bots/new` | `Button`, `Checkbox`, `Dialog`, `Input`, `Link`, `Select`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/bots` | `Badge`, `Button`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/calendar` | `Badge`, `Button`, `Input`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/cookies` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/dashboard` | `Badge`, `Button`, `Checkbox`, `ChoiceGroup`, `Input`, `Link`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/funding/history` |  | Redirect only; target is migrated. |
| `/funding` |  | Redirect only; target is migrated. |
| `/help` | `Anchor`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/login` | `Link` | Business logic, existing layout and specialized visualizations retained. |
| `/maintenance` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/market-intelligence` | `Anchor`, `Badge`, `Button`, `Dialog`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/news` | `Badge`, `Button`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/` | `Badge`, `Button`, `Checkbox`, `ChoiceGroup`, `Input`, `Link`, `Select`, `Surface`, `Table`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/predictions` | `Badge`, `Button`, `Dialog`, `Input`, `Link`, `Select`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/presale` | `Anchor`, `Badge`, `Button`, `Checkbox`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/presale/terms` | `Link` | Static legal/document content; shared Ocean tokens and solid link buttons apply. |
| `/presale/vesting` | `Anchor`, `Badge`, `Button`, `Checkbox`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/privacy` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/register` | `Checkbox`, `Link` | Business logic, existing layout and specialized visualizations retained. |
| `/reset-password` | `Link` | Business logic, existing layout and specialized visualizations retained. |
| `/risk-disclosure` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/affiliate` | `Button`, `Input`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/audit` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/bot-vaults` | `Badge`, `Button`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/exchange-accounts` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/global-defaults` | `Button`, `Input`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/notifications` | `Anchor`, `Badge`, `Button`, `Input`, `Select`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/settings` | `Badge`, `Button`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/privacy` | `Badge`, `Button`, `Input`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/risk` | `Button`, `Input`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/roles` | `Button`, `Checkbox`, `Dialog`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/security` | `Badge`, `Button`, `Input`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/setup` | `Button`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/subscription/order` | `Anchor`, `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/subscription` | `Badge`, `Button`, `Input`, `Link`, `Surface`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/trading-defaults` | `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/settings/users` | `Badge`, `Button`, `Input`, `Surface`, `Switch` | Business logic, existing layout and specialized visualizations retained. |
| `/strategies` | `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface`, `Textarea` | Business logic, existing layout and specialized visualizations retained. |
| `/terms` | `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/trade` | `Badge`, `Button`, `Checkbox`, `ChoiceGroup`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/trading-desk` | `Badge`, `Button`, `Checkbox`, `ChoiceGroup`, `Input`, `Link`, `Select`, `Surface`, `Switch`, `Table` | Business logic, existing layout and specialized visualizations retained. |
| `/uliq/locking` | `Anchor`, `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/uliq` | `Anchor`, `Badge`, `Button`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/uliq/presale` | `Anchor`, `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/uliq/vesting` | `Anchor`, `Badge`, `Button`, `Checkbox`, `Input`, `Link`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/vaults/[vaultAddress]` | `Anchor`, `Badge`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/vaults` | `Badge`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/wallet/history` | `Anchor`, `Badge`, `Link`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
| `/wallet` | `Anchor`, `Badge`, `Button`, `Checkbox`, `ChoiceGroup`, `Dialog`, `Input`, `Select`, `Surface` | Business logic, existing layout and specialized visualizations retained. |
