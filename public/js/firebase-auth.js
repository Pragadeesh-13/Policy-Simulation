(() => {
  if (typeof window === "undefined" || !window.firebase) {
    return;
  }

  const firebaseConfig = window.__FIREBASE_CONFIG__ || null;

  if (!firebaseConfig?.apiKey) {
    console.warn("[AUTH] Firebase web config missing. Set window.__FIREBASE_CONFIG__ before loading firebase-auth.js");
    return;
  }

  if (!window.firebase.apps.length) {
    window.firebase.initializeApp(firebaseConfig);
  }

  window.llmCouncilGoogleSignIn = async () => {
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const result = await window.firebase.auth().signInWithPopup(provider);
    const user = result?.user;

    if (!user) {
      throw new Error("Google sign-in failed.");
    }

    const email = String(user.email || "").trim();
    const username = email.includes("@") ? email.split("@")[0] : (user.displayName || "user").replace(/\s+/g, "").toLowerCase();
    const profile = {
      id: user.uid,
      fullName: user.displayName || "",
      username,
      email,
    };

    localStorage.setItem("llmCouncilUser", JSON.stringify(profile));
    return profile;
  };
})();
