# Storage and Privacy

MiniClue is local-first: documents and app data are stored on your machine.

## Default Storage Paths

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/miniclue/` |
| Windows | `C:\Users\{username}\AppData\Roaming\miniclue\` |
| Linux | `~/.local/share/miniclue/` |

## What Is Stored

```text
{app_data}/
|- miniclue.db
|- config.json
`- documents/
   `- {document_id}/
      `- original.pdf
```

## Privacy Notes

- MiniClue does not require a hosted app backend.
- If you choose a cloud AI provider, relevant prompts/context may be sent to that provider.
