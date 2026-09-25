// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.37;

/// @title CapitalFrontierView
/// @notice A read-only, deliberately conservative balance frontier for a
///         Safe-shaped account. It does not simulate transaction execution.
/// @dev It does not prove that the account uses authentic Safe bytecode, or
///      that an ERC-20 follows standard transfer semantics. No state writes,
///      approvals, signatures or token transfers are present.
contract CapitalFrontierView {
    struct BatchCall {
        address to;
        uint256 value;
        bytes data;
        uint8 operation;
    }

    struct Scenario {
        uint256 outflowMultiplierBps;
        uint256 nativeFeeReserve;
    }

    struct Frontier {
        uint256 fundedPrefix;
        uint256 firstBlocker;
        uint8 reason; // 0 = fully modeled, 1 = unknown call, 2 = modeled shortfall
    }

    error InvalidAccount();
    error InvalidInput();
    error InvalidToken(address token);

    bytes4 private constant TRANSFER_SELECTOR = 0xa9059cbb;

    /// @notice Read balances on the selected chain at the block chosen by
    ///         the eth_call caller, then evaluate the recognized call prefix.
    /// @param account Safe-shaped account. Interface shape is checked, not code identity.
    /// @param calls Ordered calls matching an unsigned Transaction Builder batch.
    /// @param allowedTokens Token contracts explicitly permitted for raw transfer decoding.
    /// @param scenarios Assumed outflow multipliers (10000-30000 bps) and fee reserves.
    function inspect(
        address account,
        BatchCall[] calldata calls,
        address[] calldata allowedTokens,
        Scenario[] calldata scenarios
    ) external view returns (Frontier[] memory frontiers, uint256 worstCasePrefix) {
        if (account.code.length == 0 || calls.length == 0 || calls.length > 128 ||
            allowedTokens.length > 20 || scenarios.length == 0 || scenarios.length > 20) {
            revert InvalidInput();
        }
        _requireSafeShape(account);

        uint256 nativeBalance = account.balance;
        uint256[] memory tokenBalances = new uint256[](allowedTokens.length);
        for (uint256 t = 0; t < allowedTokens.length; ++t) {
            address token = allowedTokens[t];
            if (token.code.length == 0) revert InvalidToken(token);
            for (uint256 previous = 0; previous < t; ++previous) {
                if (allowedTokens[previous] == token) revert InvalidToken(token);
            }
            (bool ok, bytes memory response) = token.staticcall(
                abi.encodeWithSelector(0x70a08231, account)
            );
            if (!ok || response.length != 32) revert InvalidToken(token);
            tokenBalances[t] = abi.decode(response, (uint256));
        }

        frontiers = new Frontier[](scenarios.length);
        worstCasePrefix = calls.length;
        for (uint256 s = 0; s < scenarios.length; ++s) {
            Scenario calldata scenario = scenarios[s];
            if (scenario.outflowMultiplierBps < 10_000 || scenario.outflowMultiplierBps > 30_000) {
                revert InvalidInput();
            }
            Frontier memory result = _evaluate(
                calls, allowedTokens, tokenBalances, nativeBalance, scenario
            );
            frontiers[s] = result;
            if (result.fundedPrefix < worstCasePrefix) worstCasePrefix = result.fundedPrefix;
        }
    }

    function _evaluate(
        BatchCall[] calldata calls,
        address[] calldata allowedTokens,
        uint256[] memory tokenBalances,
        uint256 nativeBalance,
        Scenario calldata scenario
    ) private pure returns (Frontier memory result) {
        result.firstBlocker = type(uint256).max;
        uint256 cumulativeNative;
        uint256[] memory cumulativeTokens = new uint256[](allowedTokens.length);

        for (uint256 i = 0; i < calls.length; ++i) {
            BatchCall calldata item = calls[i];
            uint256 tokenIndex = type(uint256).max;
            uint256 amount;
            bool nativeOutflow;

            if (item.operation != 0) {
                result = Frontier(i, i, 1);
                break;
            }
            if (item.data.length == 0 && item.value > 0) {
                nativeOutflow = true;
                amount = item.value;
            } else if (item.value == 0 && item.data.length == 68 &&
                       bytes4(item.data[:4]) == TRANSFER_SELECTOR) {
                for (uint256 t = 0; t < allowedTokens.length; ++t) {
                    if (allowedTokens[t] == item.to) {
                        tokenIndex = t;
                        break;
                    }
                }
                if (tokenIndex == type(uint256).max) {
                    result = Frontier(i, i, 1);
                    break;
                }
                (address recipient, uint256 decodedAmount) = abi.decode(item.data[4:], (address, uint256));
                if (recipient == address(0)) {
                    result = Frontier(i, i, 1);
                    break;
                }
                amount = decodedAmount;
            } else {
                result = Frontier(i, i, 1);
                break;
            }

            if (nativeOutflow) cumulativeNative += amount;
            else cumulativeTokens[tokenIndex] += amount;

            uint256 nativeRequired = _ceilBps(cumulativeNative, scenario.outflowMultiplierBps)
                + scenario.nativeFeeReserve;
            if (nativeRequired > nativeBalance ||
                (!nativeOutflow && _ceilBps(cumulativeTokens[tokenIndex],
                                             scenario.outflowMultiplierBps) > tokenBalances[tokenIndex])) {
                result = Frontier(i, i, 2);
                break;
            }
            result.fundedPrefix = i + 1;
        }
    }

    function _ceilBps(uint256 amount, uint256 bps) private pure returns (uint256) {
        return (amount * bps + 9_999) / 10_000;
    }

    function _requireSafeShape(address account) private view {
        (bool thresholdOk, bytes memory thresholdData) = account.staticcall(
            abi.encodeWithSelector(0xe75235b8)
        );
        (bool ownersOk, bytes memory ownersData) = account.staticcall(
            abi.encodeWithSelector(0xa0e67e2b)
        );
        if (!thresholdOk || !ownersOk || thresholdData.length != 32 || ownersData.length < 96) {
            revert InvalidAccount();
        }
        uint256 threshold = abi.decode(thresholdData, (uint256));
        address[] memory owners = abi.decode(ownersData, (address[]));
        if (owners.length == 0 || owners.length > 100 || threshold == 0 || threshold > owners.length) {
            revert InvalidAccount();
        }
        for (uint256 i = 0; i < owners.length; ++i) {
            if (owners[i] == address(0)) revert InvalidAccount();
            for (uint256 j = 0; j < i; ++j) {
                if (owners[i] == owners[j]) revert InvalidAccount();
            }
        }
    }
}
