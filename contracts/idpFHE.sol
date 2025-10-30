pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract IdPFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error BatchNotClosed();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidCooldown();
    error InvalidBatchId();
    error NotInitialized();
    error AlreadyInitialized();
    error InvalidCleartextLength();

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    bool public currentBatchClosed;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    mapping(uint256 => mapping(address => euint32)) public userAgeEncrypted;
    mapping(uint256 => mapping(address => ebool)) public userIsAdultEncrypted;
    mapping(uint256 => mapping(address => ebool)) public userIsVerifiedEncrypted;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event UserAttributesSubmitted(address indexed user, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, address indexed user, bool isAdult, bool isVerified);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier respectCooldown(address _address, mapping(address => uint256) storage _lastActionTime) {
        if (block.timestamp < _lastActionTime[_address] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60; // Default 1 minute cooldown
        currentBatchId = 1; // Start with batch 1
        currentBatchClosed = false;
        emit ProviderAdded(owner);
        emit BatchOpened(currentBatchId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); // Revert if already unpaused (or better: if (paused) { paused = false; emit...} )
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidCooldown();
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openNewBatch() external onlyOwner {
        if (!currentBatchClosed) revert BatchNotClosed();
        currentBatchId += 1;
        currentBatchClosed = false;
        emit BatchOpened(currentBatchId);
    }

    function closeCurrentBatch() external onlyOwner {
        if (currentBatchClosed) revert BatchClosed();
        currentBatchClosed = true;
        emit BatchClosed(currentBatchId);
    }

    function submitUserAttributes(
        address user,
        euint32 encryptedAge,
        ebool encryptedIsAdult,
        ebool encryptedIsVerified
    ) external onlyProvider whenNotPaused respectCooldown(user, lastSubmissionTime) {
        if (currentBatchClosed) revert BatchClosed();

        userAgeEncrypted[currentBatchId][user] = encryptedAge;
        userIsAdultEncrypted[currentBatchId][user] = encryptedIsAdult;
        userIsVerifiedEncrypted[currentBatchId][user] = encryptedIsVerified;

        lastSubmissionTime[user] = block.timestamp;
        emit UserAttributesSubmitted(user, currentBatchId);
    }

    function requestUserVerification(
        address user,
        uint256 batchId
    ) external onlyProvider whenNotPaused respectCooldown(user, lastDecryptionRequestTime) {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatchId();
        if (!FHE.isInitialized(userAgeEncrypted[batchId][user])) revert NotInitialized();
        if (!FHE.isInitialized(userIsAdultEncrypted[batchId][user])) revert NotInitialized();
        if (!FHE.isInitialized(userIsVerifiedEncrypted[batchId][user])) revert NotInitialized();

        ebool memory isAdult = userIsAdultEncrypted[batchId][user];
        ebool memory isVerified = userIsVerifiedEncrypted[batchId][user];

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(isAdult);
        cts[1] = FHE.toBytes32(isVerified);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: batchId,
            stateHash: stateHash,
            processed: false
        });

        lastDecryptionRequestTime[user] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        DecryptionContext storage ctx = decryptionContexts[requestId];

        if (ctx.processed) revert ReplayAttempt();
        if (cleartexts.length != 2 * 32) revert InvalidCleartextLength(); // Expecting 2 uint256 values

        // 1. State Verification
        // Rebuild ciphertexts from storage in the exact same order as in requestUserVerification
        bytes32[] memory currentCts = new bytes32[](2);
        currentCts[0] = FHE.toBytes32(userIsAdultEncrypted[ctx.batchId][msg.sender]); // msg.sender is the user for whom verification was requested
        currentCts[1] = FHE.toBytes32(userIsVerifiedEncrypted[ctx.batchId][msg.sender]);

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != ctx.stateHash) {
            revert StateMismatch();
        }

        // 2. Proof Verification
        FHE.checkSignatures(requestId, cleartexts, proof);

        // 3. Decode & Finalize
        uint256 isAdultCleartext = abi.decode(cleartexts[0:32], (uint256));
        bool isAdult = isAdultCleartext != 0;
        uint256 isVerifiedCleartext = abi.decode(cleartexts[32:64], (uint256));
        bool isVerified = isVerifiedCleartext != 0;

        ctx.processed = true;
        emit DecryptionCompleted(requestId, ctx.batchId, msg.sender, isAdult, isVerified);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage s, uint32 val) internal {
        if (!FHE.isInitialized(s)) {
            s = FHE.asEuint32(val);
        }
    }

    function _initIfNeeded(ebool storage b, bool val) internal {
        if (!FHE.isInitialized(b)) {
            b = FHE.asEbool(val);
        }
    }

    function _requireInitialized(euint32 storage s) internal view {
        if (!FHE.isInitialized(s)) revert NotInitialized();
    }

    function _requireInitialized(ebool storage b) internal view {
        if (!FHE.isInitialized(b)) revert NotInitialized();
    }
}