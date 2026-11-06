// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WIF Permit2 Session Mandate (prototype)
/// @notice An owner-funded EIP-1271 signer for one narrowly-scoped Permit2 exact payment proxy.
///
/// The EIP-1271 signature wrapper is exactly:
/// abi.encode(
///     address token,
///     uint256 amount,
///     address spender,
///     uint256 nonce,
///     uint256 deadline,
///     address to,
///     uint256 validAfter,
///     uint256 sessionEpoch,
///     bytes sessionSignature
/// )
///
/// This is reviewable prototype code, not production-audited code.
contract WifPermit2SessionMandate {
    // Permit2's canonical deployment address is normally supplied to the constructor as permit2.
    // The exact x402 transfer proxy is supplied separately as exactProxy and is checked as `spender`.

    bytes4 internal constant EIP1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 internal constant EIP1271_FAILURE_VALUE = 0xffffffff;

    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 internal constant PERMIT2_NAME_HASH = keccak256("Permit2");
    bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH =
        keccak256("TokenPermissions(address token,uint256 amount)");
    bytes32 internal constant WITNESS_TYPEHASH =
        keccak256("Witness(address to,uint256 validAfter)");
    bytes32 internal constant PERMIT_WITNESS_TRANSFER_FROM_TYPEHASH = keccak256(
        "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)"
    );
    bytes32 internal constant SESSION_AUTH_TYPEHASH =
        keccak256("SessionAuthorization(bytes32 permit2Digest,uint256 sessionEpoch)");
    bytes32 internal constant SESSION_NAME_HASH = keccak256("MoltworldWifSessionMandate");

    uint256 internal constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;
    address internal constant CANONICAL_WIF = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    address internal constant CANONICAL_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant CANONICAL_EXACT_PROXY = 0x402085c248EeA27D92E8b30b2C58ed07f9E20001;

    // secp256k1n / 2. Rejecting high-s signatures prevents signature malleability.
    uint256 internal constant SECP256K1N_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public immutable owner;
    address public immutable token;
    address public immutable permit2;
    address public immutable exactProxy;
    address public immutable payTo;

    address public sessionAgent;
    uint256 public maxPerCall;
    uint256 public expiry;
    uint256 public configuredAllowance;
    uint256 public sessionEpoch;
    bool public active;

    event Armed(address indexed agent, uint256 maxPerCall, uint256 expiry, uint256 allowance, uint256 sessionEpoch);
    event Revoked(uint256 sessionEpoch);
    event Withdrawn(address indexed owner, uint256 amount);

    error NotOwner();
    error ZeroAddress();
    error InvalidArm();
    error InvalidDeploymentConfig();
    error MandateActive();
    error TokenCallFailed();
    error TokenReturnedFalse();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address owner_,
        address token_,
        address permit2_,
        address exactProxy_,
        address payTo_
    ) {
        if (
            owner_ == address(0) || token_ == address(0) || permit2_ == address(0)
                || exactProxy_ == address(0) || payTo_ == address(0)
        ) revert ZeroAddress();

        // Robinhood mainnet deployments must use the canonical token, Permit2, and exact proxy.
        // Non-mainnet deployments are retained only for isolated local simulations.
        if (block.chainid == ROBINHOOD_MAINNET_CHAIN_ID) {
            if (
                token_ != CANONICAL_WIF || permit2_ != CANONICAL_PERMIT2
                    || exactProxy_ != CANONICAL_EXACT_PROXY || token_.code.length == 0
                    || permit2_.code.length == 0 || exactProxy_.code.length == 0
            ) revert InvalidDeploymentConfig();
        }

        owner = owner_;
        token = token_;
        permit2 = permit2_;
        exactProxy = exactProxy_;
        payTo = payTo_;
    }

    /// @notice Arm or replace the owner-controlled session policy.
    /// @dev The token allowance is finite and is the aggregate cap only for a standard ERC-20
    /// whose transferFrom decrements allowance. The session agent cannot call this function.
    function arm(address agent, uint256 maxPerCall_, uint256 expiry_, uint256 allowance_)
        external
        onlyOwner
    {
        if (
            agent == address(0) || maxPerCall_ == 0 || allowance_ == 0
                || allowance_ == type(uint256).max || maxPerCall_ > allowance_
                || expiry_ <= block.timestamp || allowance_ > _safeBalanceOf()
        ) revert InvalidArm();

        sessionAgent = agent;
        maxPerCall = maxPerCall_;
        expiry = expiry_;
        configuredAllowance = allowance_;
        sessionEpoch += 1;
        active = true;

        // Zero first for compatibility with tokens that require a zero-to-nonzero approval change.
        _safeApprove(0);
        _safeApprove(allowance_);

        emit Armed(agent, maxPerCall_, expiry_, allowance_, sessionEpoch);
    }

    /// @notice Disable the mandate and remove its Permit2 allowance.
    function revoke() external onlyOwner {
        active = false;
        sessionAgent = address(0);
        maxPerCall = 0;
        expiry = 0;
        configuredAllowance = 0;
        sessionEpoch += 1;

        _safeApprove(0);

        emit Revoked(sessionEpoch);
    }

    /// @notice Withdraw fixed-token funds back to the fixed owner, only while inactive.
    function withdraw(uint256 amount) external onlyOwner {
        if (active) revert MandateActive();
        _safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    /// @notice Return the current raw ERC-20 allowance from this mandate to Permit2.
    function remainingAllowance() external view returns (uint256) {
        return _safeAllowance();
    }

    /// @notice Return this mandate's fixed-token balance.
    function tokenBalance() external view returns (uint256) {
        return _safeBalanceOf();
    }

    /// @notice Pure helper exposing the exact wrapper tuple expected by isValidSignature.
    /// @dev Its parameter order intentionally mirrors the required abi.encode wrapper exactly.
    function decodeWrapper(bytes calldata wrapper)
        external
        pure
        returns (
            address wrappedToken,
            uint256 amount,
            address spender,
            uint256 nonce,
            uint256 deadline,
            address to,
            uint256 validAfter,
            uint256 wrappedSessionEpoch,
            bytes memory sessionSignature
        )
    {
        return abi.decode(
            wrapper,
            (address, uint256, address, uint256, uint256, address, uint256, uint256, bytes)
        );
    }

    /// @notice EIP-1271 validation for a wrapped, exact Permit2 witness signature.
    /// @dev Permit2 supplies `hash` as the typed-data digest. The wrapper is decoded and its
    /// fields are independently hashed so a session signature cannot be detached from its terms.
    function isValidSignature(bytes32 hash, bytes calldata wrapper)
        external
        view
        returns (bytes4)
    {
        if (!active || block.timestamp >= expiry) return EIP1271_FAILURE_VALUE;

        try this.decodeWrapper(wrapper) returns (
            address wrappedToken,
            uint256 amount,
            address spender,
            uint256 nonce,
            uint256 deadline,
            address to,
            uint256 validAfter,
            uint256 wrappedSessionEpoch,
            bytes memory sessionSignature
        ) {
            // abi.decode accepts trailing bytes; require the exact canonical abi.encode wrapper.
            if (
                keccak256(wrapper)
                    != keccak256(
                        abi.encode(
                            wrappedToken,
                            amount,
                            spender,
                            nonce,
                            deadline,
                            to,
                            validAfter,
                            wrappedSessionEpoch,
                            sessionSignature
                        )
                    )
            ) return EIP1271_FAILURE_VALUE;

            if (
                wrappedToken != token || spender != exactProxy || to != payTo
                    || amount == 0 || amount > maxPerCall || wrappedSessionEpoch != sessionEpoch
            ) return EIP1271_FAILURE_VALUE;

            // Expiry is exclusive. A permit may not remain valid past the mandate expiry.
            if (
                deadline < validAfter || deadline > expiry || block.timestamp >= deadline
                    || validAfter > block.timestamp
            ) {
                return EIP1271_FAILURE_VALUE;
            }

            // This live allowance is the aggregate spend check. A standard ERC-20 transferFrom
            // performed by Permit2 decrements it after a successful payment.
            if (amount > _safeAllowance()) return EIP1271_FAILURE_VALUE;

            bytes32 digest = _permitWitnessTransferFromDigest(
                wrappedToken, amount, spender, nonce, deadline, to, validAfter
            );
            if (
                digest != hash
                    || !_isLowSRecoveredSigner(_sessionAuthorizationDigest(hash, wrappedSessionEpoch), sessionSignature)
            ) {
                return EIP1271_FAILURE_VALUE;
            }

            return EIP1271_MAGIC_VALUE;
        } catch {
            // Malformed wrapper or malformed ABI data is an invalid EIP-1271 signature, not a
            // reason for Permit2 to observe a decoder revert from this validator.
            return EIP1271_FAILURE_VALUE;
        }
    }

    function _permitWitnessTransferFromDigest(
        address wrappedToken,
        uint256 amount,
        address spender,
        uint256 nonce,
        uint256 deadline,
        address to,
        uint256 validAfter
    ) internal view returns (bytes32) {
        bytes32 permittedHash = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, wrappedToken, amount));
        bytes32 witnessHash = keccak256(abi.encode(WITNESS_TYPEHASH, to, validAfter));
        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_WITNESS_TRANSFER_FROM_TYPEHASH,
                permittedHash,
                spender,
                nonce,
                deadline,
                witnessHash
            )
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, PERMIT2_NAME_HASH, block.chainid, permit2)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sessionAuthorizationDigest(bytes32 permit2Digest, uint256 epoch)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(SESSION_AUTH_TYPEHASH, permit2Digest, epoch));
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, SESSION_NAME_HASH, block.chainid, address(this))
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _isLowSRecoveredSigner(bytes32 digest, bytes memory signature)
        internal
        view
        returns (bool)
    {
        if (signature.length != 64 && signature.length != 65) return false;

        bytes32 r;
        bytes32 s;
        uint8 v;

        if (signature.length == 65) {
            assembly {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
        } else {
            // EIP-2098 compact form: the top bit of vs stores v - 27.
            bytes32 vs;
            assembly {
                r := mload(add(signature, 0x20))
                vs := mload(add(signature, 0x40))
            }
            s = bytes32(uint256(vs) & 0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
            v = uint8(27 + (uint256(vs) >> 255));
        }

        if (v != 27 && v != 28) return false;
        if (uint256(s) == 0 || uint256(s) > SECP256K1N_HALF_ORDER) return false;
        if (uint256(r) == 0 || uint256(r) >= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141) {
            return false;
        }

        address recovered = ecrecover(digest, v, r, s);
        return recovered != address(0) && recovered == sessionAgent;
    }

    function _safeAllowance() internal view returns (uint256 amount) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(IERC20Minimal.allowance.selector, address(this), permit2)
        );
        if (!ok || data.length != 32) return 0;
        amount = abi.decode(data, (uint256));
    }

    function _safeBalanceOf() internal view returns (uint256 amount) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, address(this))
        );
        if (!ok || data.length != 32) return 0;
        amount = abi.decode(data, (uint256));
    }

    function _safeApprove(uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.approve.selector, permit2, amount)
        );
        if (!ok) revert TokenCallFailed();
        if (data.length != 0 && (data.length != 32 || !abi.decode(data, (bool)))) {
            revert TokenReturnedFalse();
        }
    }

    function _safeTransfer(address recipient, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, recipient, amount)
        );
        if (!ok) revert TokenCallFailed();
        if (data.length != 0 && (data.length != 32 || !abi.decode(data, (bool)))) {
            revert TokenReturnedFalse();
        }
    }
}

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address account, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
}
