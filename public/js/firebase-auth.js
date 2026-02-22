(() => {
  if (typeof window === "undefined" || !window.firebase) {
    return;
  }

  const firebaseConfig = {
    apiKey: "AIzaSyDIwGeB4nnmpb2Ufhh8AMNvw0OKFYi67gQ",
    authDomain: "llm-council-4da2d.firebaseapp.com",
    projectId: "llm-council-4da2d",
    storageBucket: "llm-council-4da2d.firebasestorage.app",
    messagingSenderId: "21299434314",
    appId: "1:21299434314:web:0509aec4e29bb60d8927b3",
    measurementId: "G-MN70SJ7L0F",
  };

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
