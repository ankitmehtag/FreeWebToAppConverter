# F16 Ads

Status: approved

## Goal
A Premium app's owner can earn from their app: they paste their own Google AdMob IDs, choose a banner and/or interstitial ads and how often they appear, and the built app shows them. Where the law needs it, the app first asks the visitor for consent. An app built without ads contains no ad code at all.

## Out of scope
- Our own platform-wide ads in other people's apps (Free plan stays ad-free, as the site says today). See Q1.
- Ad networks other than AdMob (no OneSignal, no AppLovin, no mediation).
- Rewarded or native ads, and app-open ads.
- Creating the owner's AdMob account or their consent message: those are done in the AdMob console, free, by the app's owner. We show them how.
- Ad revenue reports (AdMob has its own).

## Requirements
- R1: Ads are a Premium feature. A Free app cannot turn ads on, and this is enforced by the server when a build starts and again by the worker, never only by the wizard.
- R2: The wizard has a "Monetization" step (locked with an upgrade note on Free) with: ads on/off, the AdMob app ID, a banner unit ID, an interstitial unit ID, banner position (top or bottom), and the minimum time between interstitials (default 180 s, minimum 60 s).
- R3: IDs are checked for shape before a build: app ID `ca-app-pub-<16 digits>~<10 digits>`, unit IDs `ca-app-pub-<16 digits>/<10 digits>`, all with the same publisher number. At least one unit is needed when ads are on.
- R4: Google's public test IDs are accepted, but the build page and the wizard say plainly that the app shows test ads and earns nothing until real IDs are used.
- R5: The built app shows a banner at the chosen edge without covering the page, and an interstitial only after a page change, never on launch or on exit, and never more often than the chosen gap.
- R6: When ads are on, the app asks for consent through Google's User Messaging Platform before it loads any ad, and loads none until consent allows it. It offers a "Privacy options" entry the visitor can reopen. If the owner has not made a consent message in AdMob, the app still works and shows non-personalised ads only where allowed, and the wizard warns the owner.
- R7: The owner can mark the app as directed to children, which turns on Google's child-directed and under-age treatment flags.
- R8: An app with ads off contains no AdMob or consent library, no ad service in its manifest, and no advertising-ID permission. An app with ads on declares the advertising-ID permission, plus the few permissions Google's own ad library adds by itself (ad services, network state, wake lock, foreground service); we add nothing else. (Changed during build: the first draft said "nothing else new", but the library's manifest brings these, and removing them would break Google's own ad features.)
- R9: The ad settings travel in the build config, validated like the rest of it, and the wizard's review page and the build page show whether the build has ads.
- R10: The privacy policy and the Premium description say that apps with ads use Google AdMob and may collect the advertising ID, and the site's Play-publishing checklist tells the owner to declare ads and the advertising ID in Play Console.
- R11: Builder image gets the ad libraries (Gradle cache baked in, as the build is offline). Ads-off apps stay byte-for-byte the same size class as today.
- R12: A failed ad request never breaks the page: the app shows the website normally and retries later, at most once a minute.

## Acceptance criteria
- AC1 (R1): Given a Free app with ads turned on in its config, when a build starts, then the server refuses with a clear reason; given the same config sent straight to the worker, then the worker fails the build before compiling.
- AC2 (R2, R9): Given a Premium app, when the owner sets ads and saves, then the draft keeps the settings and the review page shows "Ads: banner + interstitial".
- AC3 (R3): Given malformed IDs, mixed publisher numbers, or no unit with ads on, then saving or building is refused with the field named; given valid IDs, it passes.
- AC4 (R4): Given Google's test app ID, then the wizard and the build page show the test-ads notice.
- AC5 (R5): Given a built Premium APK on a real phone with test IDs, then a banner shows at the chosen edge, an interstitial shows after a page change but not on launch, and two interstitials are never closer than the gap.
- AC6 (R6): Given a phone set to an EEA region (or the UMP debug flag), when the app opens, then the consent form shows before any ad and no ad request happens until it is answered; the "Privacy options" entry reopens it.
- AC7 (R7): Given the child-directed option, then the ad requests carry the child-directed flag (checked in the app's unit test).
- AC8 (R8): Given an ads-off APK, `aapt2 dump badging` and the merged manifest have no AD_ID permission and no ad component, and the dex has no `com.google.android.gms.ads` or `com.google.android.ump` classes; the ads-on APK has the permission and the classes.
- AC9 (R12): Given no network or a refused ad request, then the page still loads and the app does not crash or retry faster than once a minute.
- AC10 (R10): Given the privacy page and the Premium description, then they contain the AdMob and advertising-ID wording.
- AC11 (R11): Given the new builder image, `verify-image` passes for an ads-off and an ads-on sample, signs both, and the key is absent from the layers.

## Open questions
- Q1: Should the Free plan show our own ads to earn for the site? Proposed: no. Wrapped sites can carry content AdMob forbids (adult, gambling, weapons), and a policy strike would hit your one AdMob account for every app at once. Keep Free ad-free and put ads only in Premium apps, under each owner's own AdMob account, so their account carries their risk.
- Q2: Only Premium, as proposed in R1? Proposed: yes. There is no Starter plan today.
- Q3: Interstitial default gap 180 s and minimum 60 s, banner top or bottom. Proposed: yes, and the minimum protects the owner from AdMob's "too many ads" policy.
- Q4: Consent: use Google's UMP for everyone with ads on (it decides by region itself). Proposed: yes, it is free and is what AdMob requires for the EEA, UK and some other places.
- Q5: Real ads can only be seen with a real AdMob account and a phone. Proposed: the verification uses Google's test IDs on your phone (free); a real-ID check is yours to do with the account of whoever publishes the app.
- Q6: `docs/FEATURES.md` still lists F15 Push as "not started" although push is live and checked on your phone. Proposed: I mark it done after you confirm you signed it off.
