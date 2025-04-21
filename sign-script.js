document.addEventListener("DOMContentLoaded", () => {
  const signInBtn = document.getElementById("sign-in-btn");
  const changePinBtn = document.getElementById("change-pin-btn");

  signInBtn.addEventListener("click", async () => {
    const credential = document.getElementById("sign-in-name").value;
    const pin = document.getElementById("sign-in-pin").value;

    if (!credential || !pin) {
      document.getElementById("sign-in-message").textContent =
        "All fields are required.";
      return;
    }

    const res = await fetch("http://localhost:3000/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential, pin }),
    });

    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      // Store user data properly
      localStorage.setItem(
        "user",
        JSON.stringify({
          Id: data.user.Id,
          name: data.user.name,
          email: data.user.email,
          country: data.user.country,
        })
      );
      window.location.href = "home.html";
    } else {
      document.getElementById("sign-in-message").textContent = data.message;
    }
  });

  changePinBtn.addEventListener("click", async () => {
    const newPin = document.getElementById("new-pin").value;
    const confirmNewPin = document.getElementById("confirm-new-pin").value;
    const credential = sessionStorage.getItem("currentUser");

    if (newPin.length !== 4 || newPin !== confirmNewPin) {
      document.getElementById("change-pin-message").textContent =
        "PINs do not match or are invalid.";
      return;
    }

    const res = await fetch("http://localhost:3000/api/change-pin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionStorage.getItem("token")}`,
      },
      body: JSON.stringify({ credential, newPin }),
    });

    const data = await res.json();
    if (res.ok) {
      alert("PIN changed successfully");
      window.location.href = "home.html";
    } else {
      document.getElementById("change-pin-message").textContent = data.message;
    }
  });
});
