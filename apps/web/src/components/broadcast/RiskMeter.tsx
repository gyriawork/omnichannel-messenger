'use client';

interface RiskMeterProps {
  /** 0.0 (safe) to 1.0 (dangerous) */
  riskLevel: number;
  estimatedTime?: string;
  dailyCapacity?: number;
  warning?: string;
}

function getRiskLabel(level: number): { label: string; color: string } {
  if (level < 0.2) return { label: 'Safe', color: 'text-green-600' };
  if (level < 0.5) return { label: 'Moderate', color: 'text-yellow-600' };
  if (level < 0.8) return { label: 'Risky', color: 'text-orange-600' };
  return { label: 'Dangerous', color: 'text-red-600' };
}

export default function RiskMeter({ riskLevel, estimatedTime, dailyCapacity, warning }: RiskMeterProps) {
  const { label, color } = getRiskLabel(riskLevel);
  const markerPosition = Math.min(Math.max(riskLevel * 100, 2), 98);

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-500">
        <span>Safe</span>
        <span>Moderate</span>
        <span>Risky</span>
        <span>Dangerous</span>
      </div>

      {/* Gradient bar */}
      <div className="relative h-3 rounded-full bg-gradient-to-r from-green-400 via-yellow-400 via-orange-400 to-red-500">
        <div
          className="absolute top-[-4px] w-5 h-5 bg-white border-2 border-gray-800 rounded-full shadow-md transform -translate-x-1/2"
          style={{ left: `${markerPosition}%` }}
        />
      </div>

      {/* Info */}
      <div className="flex justify-between items-center">
        <span className={`text-sm font-medium ${color}`}>{label}</span>
        <div className="text-xs text-gray-500 space-x-4">
          {estimatedTime && <span>Est. time: {estimatedTime}</span>}
          {dailyCapacity != null && <span>Daily capacity: {dailyCapacity} msgs</span>}
        </div>
      </div>

      {warning && (
        <p className="text-xs text-orange-600 bg-orange-50 dark:bg-orange-900/20 px-3 py-1.5 rounded-md">
          {warning}
        </p>
      )}
    </div>
  );
}
