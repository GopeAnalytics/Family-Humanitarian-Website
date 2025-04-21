// Wait for the DOM to load
document.addEventListener("DOMContentLoaded", () => {
  // Toggle the navigation menu
  const hamburger = document.querySelector(".hamburger");
  const nav = document.querySelector("nav");

  hamburger.addEventListener("click", () => {
    // Toggle the 'active' class for the hamburger and navigation menu
    hamburger.classList.toggle("active");
    nav.classList.toggle("active");
  });
  document.addEventListener("DOMContentLoaded", () => {
    const userName = sessionStorage.getItem("currentUser");
    const userInitials = sessionStorage.getItem("userInitials");

    if (!userName) {
      alert("You must log in first.");
      window.location.href = "sign.html"; // Redirect to login page if not logged in
    } else {
      // Display user initials in a small round yellow circle
      const userCircle = document.createElement("div");
      userCircle.textContent = userInitials;

      document.body.appendChild(userCircle);
    }
  });
  const sheetUrls = {
    expenditure:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vRJhHBhBVTNac9rwXHYOoU0ZC7PWy-euWf-A0X5xU2G_a0FYCg5RTiaH3sygaNNVNfWXKTIgSO7BJ4Y/pubhtml?gid=1600776302&single=true",
    receipts:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vTGUVHqadLXkMMMYTqveJozm3pUww5PLoYXvs0Dcm8U3AuZOsqqCqmCmVXkeSeZ82FQ7ARHPhLW-dWo/pub?gid=1910741080&single=true",
    balance:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vRHw6u2AjTlo2pVY2Zq7grvI0RqGECHAS7nYvDhGYAeak4eppe8BY7YYS_K3gIJ5tJXykKUWEmq114n/pubhtml?gid=0&single=true",
  };

  async function fetchData(sheetUrl, name) {
    try {
      const response = await fetch(sheetUrl);
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const rows = doc.querySelectorAll("table tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells[0] && cells[0].innerText.trim() === name) {
          return cells[1]?.innerText.trim() || "0";
        }
      }
      return "Data not found.";
    } catch (error) {
      console.error(error);
      return "Error fetching data.";
    }
  }

  async function updateData() {
    const name = document.getElementById("nameSelect").value;
    if (!name) {
      document.getElementById("expenditureOutput").innerText = "";
      document.getElementById("receiptsOutput").innerText = "";
      document.getElementById("balanceOutput").innerText = "";
      return;
    }

    const expenditureValue = await fetchData(sheetUrls.expenditure, name);
    const receiptsValue = await fetchData(sheetUrls.receipts, name);
    const balanceValue = await fetchData(sheetUrls.balance, name);

    document.getElementById(
      "expenditureOutput"
    ).innerHTML = `The value for ${name} is:</p> Ksh. ${expenditureValue}`;
    document.getElementById(
      "receiptsOutput"
    ).innerHTML = `The value for ${name} is: </p>Ksh. ${receiptsValue}`;
    document.getElementById(
      "balanceOutput"
    ).innerHTML = `The balance for ${name} is: </p>Ksh. ${balanceValue}`;
  }
  // Function to handle user logout
  function logoutUser() {
    // Clear user session or data (example for localStorage)
    localStorage.clear(); // Adjust based on your storage method (session, cookies, etc.)

    // Redirect to a login or home page
    alert("You have successfully logged out.");
    window.location.href = "sign.html"; // Redirect to the sign-in page
  }
  const fromCurrency = document.getElementById("fromCurrency");
  const toCurrency = document.getElementById("toCurrency");
  const fromFlag = document.getElementById("fromFlag");
  const toFlag = document.getElementById("toFlag");
  const buyRate = document.getElementById("buyRate");
  const sellRate = document.getElementById("sellRate");
  const selectedFromCurrency = document.getElementById("selectedFromCurrency");
  const selectedFromCurrency2 = document.getElementById(
    "selectedFromCurrency2"
  );

  fromCurrency.addEventListener("change", updateCurrency);
  toCurrency.addEventListener("change", updateCurrency);

  function updateCurrency() {
    const selectedFromOption = fromCurrency.options[fromCurrency.selectedIndex];
    const selectedToOption = toCurrency.options[toCurrency.selectedIndex];

    fromFlag.src = selectedFromOption.dataset.flag;
    toFlag.src = selectedToOption.dataset.flag;

    selectedFromCurrency.textContent = selectedFromOption.value;
    selectedFromCurrency2.textContent = selectedFromOption.value;

    fetchExchangeRates(selectedFromOption.value, selectedToOption.value);
  }

  async function fetchExchangeRates(base, target) {
    try {
      const response = await fetch(
        `https://api.exchangerate-api.com/v4/latest/${base}`
      );
      const data = await response.json();

      const buyRateValue = data.rates[target];
      const sellRateValue = buyRateValue * 1.05;

      buyRate.textContent = buyRateValue.toFixed(2);
      sellRate.textContent = sellRateValue.toFixed(2);
    } catch (error) {
      console.error("Error fetching exchange rates:", error);
    }
  }

  fetchExchangeRates("USD", "KES");
  // Handle dropdown menu functionality
  const dropdown = document.querySelector(".dropdown");
  const dropdownMenu = document.querySelector(".dropdown-menu");

  dropdown.addEventListener("click", (e) => {
    e.preventDefault(); // Prevent default link behavior
    dropdownMenu.classList.toggle("visible"); // Show or hide the dropdown menu
  });

  // Hide dropdown menu when clicking outside
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && !dropdownMenu.contains(e.target)) {
      dropdownMenu.classList.remove("visible");
    }
  });

  // Toggle 'Show balance' button
  const showBalanceButton = document.querySelector(".show-balance");
  let isBalanceVisible = false;

  showBalanceButton.addEventListener("click", () => {
    if (isBalanceVisible) {
      showBalanceButton.textContent = "Show balance";
      isBalanceVisible = false;
    } else {
      showBalanceButton.textContent = "Balance: $1,000"; // Replace with actual balance value
      isBalanceVisible = true;
    }
  });

  // Simulate more options (ellipsis functionality)
  const moreOptions = document.querySelector(".more-options");
  moreOptions.addEventListener("click", () => {
    alert("More options coming soon!");
  });
});

document.getElementById("submitBtn").addEventListener("click", async () => {
  const form = document.getElementById("fundRequestForm");
  const successMessage = document.getElementById("successMessage");

  // Clear previous error messages
  document.querySelectorAll('span[id$="Error"]').forEach((span) => {
    span.style.display = "none";
  });

  let isValid = true;

  // Validate email
  const email = document.getElementById("email").value.trim();
  if (!email) {
    document.getElementById("emailError").style.display = "inline";
    isValid = false;
  }

  // Validate name
  const name = document.getElementById("name").value.trim();
  if (!name) {
    document.getElementById("nameError").style.display = "inline";
    isValid = false;
  }

  // Validate country
  const country = document.getElementById("country").value.trim();
  if (!country) {
    document.getElementById("countryError").style.display = "inline";
    isValid = false;
  }

  // Validate type of request
  const typeOfRequest = document.getElementById("type-of-request").value.trim();
  if (!typeOfRequest) {
    document.getElementById("typeOfRequestError").style.display = "inline";
    isValid = false;
  }

  // Validate amount
  const amount = document.getElementById("amount").value.trim();
  if (!amount) {
    document.getElementById("amountError").style.display = "inline";
    isValid = false;
  }

  // Validate quantity
  const quantity = document.getElementById("quantity").value.trim();
  if (!quantity) {
    document.getElementById("quantityError").style.display = "inline";
    isValid = false;
  }

  // Validate total amount
  const totalAmount = document.getElementById("total-amount").value.trim();
  if (!totalAmount) {
    document.getElementById("totalAmountError").style.display = "inline";
    isValid = false;
  }

  if (!isValid) {
    return; // Stop submission if validation fails
  }

  // Create FormData object to collect form data
  const formData = new FormData(form);

  try {
    // Send form data to the Google Apps Script Web App URL
    const response = await fetch(
      "https://script.google.com/macros/s/AKfycbyu6MiP1_Qh9iP0i4FOgS6HjdCa7dGHe9GSgMGbSEsfMIx3QdtEdWbNA11Cfk07X5c/exec",
      {
        method: "POST",
        body: new URLSearchParams([...formData]), // Converts FormData to URL-encoded string
      }
    );

    if (response.ok) {
      // Display success message below the form
      successMessage.textContent = "Form submitted successfully! Thank you.";
      successMessage.style.color = "green";
      successMessage.style.display = "block";

      // Clear the form fields
      form.reset();

      // Clear the total amount field (readonly field won't reset with .reset())
      document.getElementById("total-amount").value = "";

      // Hide the success message after 3 seconds
      setTimeout(() => {
        successMessage.style.display = "none";
      }, 3000);
    } else {
      throw new Error("Failed to submit form. Please try again.");
    }
  } catch (error) {
    // Handle errors (e.g., network issues or server error)
    successMessage.textContent = `Error: ${error.message}`;
    successMessage.style.color = "red";
    successMessage.style.display = "block";

    // Hide the error message after 5 seconds
    setTimeout(() => {
      successMessage.style.display = "none";
    }, 5000);
  }
});
