
# FHE-based Identity Provider (IdP) for Web2 & Web3 Integration

Transforming digital identity management, this project is an innovative, decentralized identity provider (IdP) that leverages **Zama's Fully Homomorphic Encryption (FHE) technology** to protect user identity attributes. By enabling secure single sign-on (SSO) across both Web2 platforms and Web3 decentralized applications, it ensures users can validate necessary attributes without unnecessary data exposure.

## The Challenge of Digital Identity

In an era where data breaches are commonplace and user privacy is increasingly at risk, traditional identity solutions like Google and Facebook login present significant vulnerabilities. Users are often compelled to surrender sensitive personal information to access services — a practice that undermines privacy and control over personal data. The need for a robust, user-controlled identity infrastructure has never been more urgent.

## How FHE Addresses These Concerns

With **Zama's FHE technology**, our IdP provides a secure method for managing user identities while retaining privacy. By encrypting identity attributes, we ensure that even in the case of exposure, the data remains confidential and useless to malicious actors. This implementation utilizes Zama’s open-source libraries, specifically designed for confidential computing, such as the **Concrete** and **TFHE-rs** libraries, enabling users to authenticate with only essential information, such as confirming their age, without revealing their entire identity.

## Core Functionalities

- **Encrypted User Attributes:** All user identity properties are securely encrypted using FHE, ensuring maximum confidentiality.
- **Privacy-First Single Sign-On (SSO):** Supports seamless sign-in across Web2 and Web3 applications while protecting user privacy.
- **DID Integration:** Designed to pave the way for decentralized identifiers (DIDs), enhancing user autonomy over their digital identities.
- **User-Centric Identity Management:** Users maintain control over which attributes are shared with which services, promoting greater transparency.

## Technology Stack

This project employs a modern tech stack, emphasizing privacy and security through the following components:

- **Zama FHE SDK** (for confidential computing)
- **Node.js** (for backend services)
- **Express.js** (for API development)
- **Ethers.js** (for Ethereum interaction)
- **MongoDB** (for secure data storage)

## Directory Structure

Here’s the structure of the project:

```
idpFHE/
│
├── contracts/
│   └── idpFHE.sol
│
├── src/
│   ├── api/
│   ├── config/
│   ├── controllers/
│   ├── middleware/
│   └── models/
│
├── tests/
│   ├── unit/
│   └── integration/
│
├── .env
├── package.json
└── README.md
```

## Installation Guide

To set up the project, ensure you have the following installed on your machine:

- **Node.js** (version 14 or higher)
- **Hardhat** or **Foundry** (for Ethereum development)

Once you've downloaded the project files, navigate to the project directory and run the following command to install all dependencies, including the Zama FHE libraries:

```bash
npm install
```

**Note:** Do not use `git clone` or any URLs to download the project; ensure you have a local copy of the files through other means.

## Build & Run Instructions

After successfully installing the dependencies, you can compile and test the contracts and application using the following commands:

1. **Compile the Smart Contracts:**
   ```bash
   npx hardhat compile
   ```

2. **Run the Tests:**
   ```bash
   npx hardhat test
   ```

3. **Start the Development Server:**
   ```bash
   npm start
   ```

This will launch the application, allowing you to interact with the IdP, experiment with the SSO features, and test the encryption of identity attributes.

## Example Usage

Here’s a simple example of how to authenticate a user with our IdP, demonstrating the primary function of validating the user's age without exposing sensitive data:

```javascript
const { authenticateUser } = require('./src/controllers/authController');

// Sample user login function
async function loginUser(username, password) {
    const user = await authenticateUser(username, password);
    if (user && user.isAdult) {
        console.log("Login successful: User is of legal age.");
    } else {
        console.log("Login failed: User is not of legal age or user does not exist.");
    }
}

// Call the login function
loginUser('john_doe', 'password123');
```

This code illustrates how a user can authenticate without exposing their full identity information while still confirming a critical attribute.

## Acknowledgements

### Powered by Zama

A heartfelt thanks to the Zama team for their groundbreaking work in the realm of FHE technology and the open-source tools that make secure and confidential blockchain applications a reality. Your efforts are essential to advancing the way we think about digital identity and security.

---

By combining the innovative aspects of decentralized identity management with the unparalleled security of Zama's FHE technology, this identity provider is set to redefine how users interact with digital platforms while keeping their data safe and under their control.
```
