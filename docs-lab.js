// 事業所ごとの設定（書類の名前と署名欄）。書類の文章はGoogle側（Apps Script の 書類.gs）にあり、職員コードを入れると読み込む。
window.APP_CONFIG = {
 "office": "lab",
 "name": "心を育てる　ふらここラボ",
 "short": "ふらここラボ",
 "subtitle": "同意書署名システム",
 "folderLabel": "_同意書_ふらここラボ",
 "mode": "child",
 "footer": "株式会社ふらここ　心を育てる　ふらここラボ　秋田市保戸野中町6番13号",
 "docs": [
  {
   "key": "important",
   "title": "重要事項説明書",
   "note": "上記の重要事項について説明を受け、内容を理解しました。",
   "signers": [
    "guardian",
    "staff"
   ]
  },
  {
   "key": "contract",
   "title": "利用契約書",
   "note": "上記の契約内容の全文を確認し、同意しました。",
   "signers": [
    "guardian"
   ]
  },
  {
   "key": "privacy",
   "title": "個人情報保護に関する同意書",
   "note": "上記の内容について説明を受け、同意しました。",
   "signers": [
    "guardian"
   ]
  }
 ]
};
