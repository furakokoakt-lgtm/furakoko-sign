// 事業所ごとの設定（書類の名前と署名欄）。書類の文章はGoogle側（Apps Script の 書類.gs）にあり、職員コードを入れると読み込む。
window.APP_CONFIG = {
 "office": "soudan",
 "name": "相談支援事業所ふらここ",
 "short": "相談支援ふらここ",
 "subtitle": "同意書署名システム",
 "folderLabel": "_同意書",
 "mode": "adult",
 "footer": "株式会社ふらここ　秋田市御所野元町3-8-16　TEL 018-839-8657",
 "docs": [
  {
   "key": "contract",
   "title": "利用契約書",
   "note": "上記の契約内容の全文を確認し、同意しました。",
   "signers": [
    "user",
    "guardian?"
   ]
  },
  {
   "key": "important",
   "title": "重要事項説明書",
   "note": "上記の重要事項について説明を受け、内容を確認しました。",
   "signers": [
    "user",
    "staff"
   ]
  },
  {
   "key": "privacy",
   "title": "個人情報使用同意書",
   "note": "上記の内容について同意しました。",
   "signers": [
    "user",
    "guardian?"
   ]
  }
 ]
};
