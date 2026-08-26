# Finance pod kontrolou — PWA

Převod Android/Jetpack Compose aplikace do responzivní PWA s Firebase.

## Co je hotové

- Firebase Authentication: registrace + přihlášení e-mailem a heslem
- Firestore: transakce, kategorie, rozpočty, cíle, spoření a investice
- Firebase Storage: fotografie účtenek
- Firestore IndexedDB offline cache
- PWA manifest + service worker + instalace do zařízení
- Dashboard, zápis výdajů/příjmů, historie, grafy, cíle, spoření/investice, finanční rádce a nastavení
- responzivní desktop/mobile design
- bezpečnostní pravidla pro Firestore a Storage

## Spuštění

1. `npm install`
2. `npm run dev`
3. pro produkci `npm run build`
4. výsledný `dist/` nasadit např. na Firebase Hosting.

Firebase projekt je přednastaven podle konfigurace dodané v zadání.

## Firebase konzole

Je potřeba povolit:
- Authentication → Sign-in method → Email/Password
- Firestore Database
- Storage

Pak nasadit pravidla:
- `firebase deploy --only firestore:rules`
- `firebase deploy --only storage`

## Poznámka k AI/OCR

Android verze používala lokální AI model a OCR pipeline. Webová verze záměrně nepřenáší 2–4GB model do PWA. Finanční rádce je zatím lokální pravidlový modul a účtenka se ukládá do Firebase Storage. Pro produkční OCR/AI lze následně připojit zabezpečený backend/Cloud Function bez změny datového modelu.
