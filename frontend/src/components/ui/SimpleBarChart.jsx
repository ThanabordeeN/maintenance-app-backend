
import React from 'react';

const SimpleBarChart = ({ data, height = 200, color = 'bg-blue-500' }) => {
    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center p-4 text-gray-500 bg-gray-900/30 rounded-lg h-[200px]">
                No Data Available
            </div>
        );
    }

    const maxValue = Math.max(...data.map(d => d.value), 1); // Avoid division by zero

    return (
        <div className="w-full">
            <div className="flex items-end justify-between gap-2" style={{ height: `${height}px` }}>
                {data.map((item, index) => {
                    const percentage = (item.value / maxValue) * 100;
                    return (
                        <div key={index} className="group relative flex-1 flex flex-col justify-end items-center h-full">
                            {/* Tooltip */}
                            <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center bg-gray-800 text-white text-xs p-2 rounded shadow-lg z-10 whitespace-nowrap">
                                <span className="font-bold">{item.label}</span>
                                <span>{item.value} รายการ</span>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
                            </div>

                            {/* Bar */}
                            <div
                                className={`w-full max-w-[40px] rounded-t-sm transition-all duration-500 relative ${item.color || color} hover:brightness-110`}
                                style={{ height: `${percentage}%` }}
                            >
                                {/* Value Label on top of bar if space permits, or hide if too small */}
                                {percentage > 15 && (
                                    <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] text-white/90 font-bold">
                                        {item.value}
                                    </span>
                                )}
                            </div>

                            {/* X-Axis Label */}
                            <div className="mt-2 text-[10px] sm:text-xs text-gray-500 rotate-0 truncate w-full text-center">
                                {item.label}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SimpleBarChart;
