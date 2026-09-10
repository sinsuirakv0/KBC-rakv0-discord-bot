# Northflank無料枠での保存方針

2026-09-06採用。ユーザー決定は[保存要件](../requirements/storage.md)、現在のコードは[保存実装](../implementation/storage.md)を参照。

専用private GitHubリポジトリを正本とし、追加DBと永続ローカルディスクを前提にしない。メモリ・一時ファイルだけで成功応答すると再起動時に失われるため、設定と配送の重要な保存はGitHubの確定を待つ。通知前の送信予定保存、および結果不明時の自動再投稿保留はユーザー承認済み。

Northflankの一時ストレージは復元元にできない。[Northflank storage](https://northflank.com/docs/v1/application/scale/increase-storage)
無料DB枠の空きは未確認であり、この実装の前提にしない。[Northflank pricing](https://northflank.com/pricing)

GitHub Contents APIのSHA照合と書き込み直列化を使う。応答消失時は保存内容を読み戻し、古い状態を新しいSHAで無条件に上書きしない。[GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)
最低1秒の書き込み間隔と制限応答への待機を実装する。この間隔だけで制限回避を保証しない。[GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

Discord送信とGitHub記録を同一トランザクションにはできない。送信直前にattemptingを記録し、投稿IDが残らなかった場合は重複回避を優先して保留する。この場合、実際は未送信だった通知も保留になり得る。固定nonceは補助であり、長期間の重複防止保証には使わない。[Discord Create Message](https://docs.discord.com/developers/resources/message#create-message)

## 再検討条件と残件

- 保存待ちやAPI制限が運用を妨げる規模ではDBへ移行する。保存確認を省くことで対処しない。
- 複数プロセスの同時稼働が必要なら分散排他を再設計する。Northflankの旧新切替方法は本番設定時に確認する。
- 送信側event repoにskdの永続outboxを実装済み。未配信payloadと同じeventIdを次のActions runへ持ち越し、原本保存済みでも配送待ちを捨てない。
- 記録の保持期間、再送期限、整理方法は未決定。自動削除は行わない。
- 権限コマンドと健康維持メンテナーの操作範囲は後続作業。
