import React from 'react';
import { ChevronLeft, ChevronRight, Filter, RefreshCw, Search } from 'lucide-react';
import ClipLoader from 'react-spinners/ClipLoader';

export default function ActivitySection({
  activityLogs,
  activityPagination,
  loadingActivity,
  activityDateFilter,
  activityDateRange,
  activitySearchInput,
  setActivitySearchInput,
  onDateFilterChange,
  onCustomDateChange,
  onSearchActivity,
  onClearFilters,
  onRefresh,
  onChangePage,
  onChangeLimit
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Activity Log</h2>
          <p className="text-gray-500 mt-1">Track all admin actions and changes</p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loadingActivity}
          className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loadingActivity ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex flex-col gap-1 max-w-[200px]">
              <span className="text-xs text-gray-500 font-medium">Search</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="User, action, details..."
                  value={activitySearchInput}
                  onChange={(e) => setActivitySearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onSearchActivity();
                    }
                  }}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border-2 border-gray-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500 font-medium">Date Range</span>
              <select
                value={activityDateFilter}
                onChange={(e) => onDateFilterChange(e.target.value)}
                className="px-3 py-2.5 rounded-xl border-2 border-gray-200 text-sm bg-white"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            {activityDateFilter === 'custom' && (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 font-medium">From:</span>
                  <input
                    type="date"
                    value={activityDateRange.date_from}
                    onChange={(e) => onCustomDateChange('date_from', e.target.value)}
                    className="px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-emerald-400 text-sm bg-white"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-gray-500 font-medium">To:</span>
                  <input
                    type="date"
                    value={activityDateRange.date_to}
                    onChange={(e) => onCustomDateChange('date_to', e.target.value)}
                    className="px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-emerald-400 text-sm bg-white"
                  />
                </div>
              </>
            )}
            <button
              onClick={onSearchActivity}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold rounded-xl hover:from-emerald-600 hover:to-teal-700 transition-all shadow-sm text-sm mt-5"
            >
              <Search className="w-4 h-4 inline mr-1" />
              Search
            </button>
            <button
              onClick={onClearFilters}
              className="px-4 py-2.5 rounded-xl border-2 border-gray-200 text-gray-700 hover:bg-gray-50 transition-all text-sm font-medium mt-5"
            >
              <Filter className="w-4 h-4 inline mr-1" />
              Clear
            </button>
          </div>
        </div>

        {loadingActivity ? (
          <div className="flex justify-center py-16">
            <ClipLoader size={36} color="#3B82F6" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Details</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Date & Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activityLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                            <span className="text-blue-600 font-semibold text-sm">{log.username?.[0]?.toUpperCase() || '?'}</span>
                          </div>
                          <span className="font-medium text-gray-800">{log.username || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          log.action.includes('create') ? 'bg-emerald-100 text-emerald-700' :
                          log.action.includes('update') ? 'bg-blue-100 text-blue-700' :
                          log.action.includes('delete') ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {log.action.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-sm max-w-xs truncate">
                        {log.details ? JSON.stringify(log.details) : '-'}
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-sm">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {activityLogs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-16 text-center">
                        <p className="text-gray-500">No activity logs found</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {activityPagination.total > 0 && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                <div className="text-sm text-gray-500">
                  Showing {Math.min((activityPagination.page - 1) * activityPagination.limit + 1, activityPagination.total)} - {Math.min(activityPagination.page * activityPagination.limit, activityPagination.total)} of {activityPagination.total} entries
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={activityPagination.limit}
                    onChange={(e) => onChangeLimit(Number(e.target.value))}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value={20}>20 per page</option>
                    <option value={10}>10 per page</option>
                    <option value={5}>5 per page</option>
                    <option value={50}>50 per page</option>
                  </select>
                  <button
                    onClick={() => onChangePage(activityPagination.page - 1)}
                    disabled={activityPagination.page <= 1}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: activityPagination.total_pages }, (_, i) => i + 1).map(page => (
                      <button
                        key={page}
                        onClick={() => onChangePage(page)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                          page === activityPagination.page
                            ? 'bg-blue-500 text-white'
                            : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => onChangePage(activityPagination.page + 1)}
                    disabled={activityPagination.page >= activityPagination.total_pages}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
